/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

import { URI } from '../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { ILLMMessageService } from '../../../../platform/void/common/llmMessageService.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { chat_userMessage, chat_systemMessage } from './prompt/prompts.js';

// one of the square items that indicates a selection in a chat bubble (NOT a file, a Selection of text)
export type CodeSelection = {
	type: 'Selection';
	fileURI: URI;
	selectionStr: string;
	range: IRange;
}

export type FileSelection = {
	type: 'File';
	fileURI: URI;
	selectionStr: null;
	range: null;
}

export type StagingSelectionItem = CodeSelection | FileSelection


// WARNING: changing this format is a big deal!!!!!! need to migrate old format to new format on users' computers so people don't get errors.
export type ChatMessage =
	| {
		role: 'user';
		content: string | null; // content sent to the llm - allowed to be '', will be replaced with (empty)
		displayContent: string | null; // content displayed to user  - allowed to be '', will be ignored
		selections: StagingSelectionItem[] | null; // the user's selection
		stagingSelections: StagingSelectionItem[] | null; // staging selections in edit mode
	}
	| {
		role: 'assistant';
		content: string | null; // content received from LLM  - allowed to be '', will be replaced with (empty)
		displayContent: string | null; // content displayed to user (this is the same as content for now) - allowed to be '', will be ignored
	}
	| {
		role: 'system';
		content: string;
		displayContent?: undefined;
	}

// a 'thread' means a chat message history
export type ChatThreads = {
	[id: string]: {
		id: string; // store the id here too
		createdAt: string; // ISO string
		lastModified: string; // ISO string
		messages: ChatMessage[];
		stagingSelections: StagingSelectionItem[] | null;
		focusedMessageIdx?: number | undefined; // index of the message that is being edited (undefined if none)
	};
}

export type ThreadsState = {
	allThreads: ChatThreads;
	currentThreadId: string; // intended for internal use only
}

export type ThreadStreamState = {
	[threadId: string]: undefined | {
		error?: { message: string, fullError: Error | null };
		messageSoFar?: string;
		streamingToken?: string;
	}
}


const newThreadObject = () => {
	const now = new Date().toISOString()
	return {
		id: new Date().getTime().toString(),
		createdAt: now,
		lastModified: now,
		messages: [],
		focusedMessageIdx: undefined,
		stagingSelections: null,
	} satisfies ChatThreads[string]
}

const THREAD_VERSION_KEY = 'void.chatThreadVersion'
const THREAD_VERSION = 'v1'

const THREAD_STORAGE_KEY = 'void.chatThreadStorage'

export interface IChatThreadService {
	readonly _serviceBrand: undefined;

	readonly state: ThreadsState;
	readonly streamState: ThreadStreamState;

	onDidChangeCurrentThread: Event<void>;
	onDidChangeStreamState: Event<{ threadId: string }>

	getCurrentThread(): ChatThreads[string];
	openNewThread(): void;
	switchToThread(threadId: string): void;

	getFocusedMessageIdx(): number | undefined;
	setFocusedMessageIdx(messageIdx: number | undefined): void;

	_useStagingSelectionsState(messageIdx?: number | undefined): readonly [StagingSelectionItem[], (selections: StagingSelectionItem[]) => void];

	editUserMessageAndStreamResponse(userMessage: string, messageIdx: number): Promise<void>;
	addUserMessageAndStreamResponse(userMessage: string): Promise<void>;
	cancelStreaming(threadId: string): void;
	dismissStreamError(threadId: string): void;

}

export const IChatThreadService = createDecorator<IChatThreadService>('voidChatThreadService');
class ChatThreadService extends Disposable implements IChatThreadService {
	_serviceBrand: undefined;

	// this fires when the current thread changes at all (a switch of currentThread, or a message added to it, etc)
	private readonly _onDidChangeCurrentThread = new Emitter<void>();
	readonly onDidChangeCurrentThread: Event<void> = this._onDidChangeCurrentThread.event;

	readonly streamState: ThreadStreamState = {}
	private readonly _onDidChangeStreamState = new Emitter<{ threadId: string }>();
	readonly onDidChangeStreamState: Event<{ threadId: string }> = this._onDidChangeStreamState.event;

	state: ThreadsState // allThreads is persisted, currentThread is not

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IModelService private readonly _modelService: IModelService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
	) {
		super()

		this.state = {
			allThreads: this._readAllThreads(),
			currentThreadId: null as unknown as string, // gets set in startNewThread()
		}

		// always be in a thread
		this.openNewThread()

		// for now just write the version, anticipating bigger changes in the future where we'll want to access this
		this._storageService.store(THREAD_VERSION_KEY, THREAD_VERSION, StorageScope.APPLICATION, StorageTarget.USER)
	}


	private _readAllThreads(): ChatThreads {
		// PUT ANY VERSION CHANGE FORMAT CONVERSION CODE HERE
		// CAN ADD "v0" TAG IN STORAGE AND CONVERT
		const threads = this._storageService.get(THREAD_STORAGE_KEY, StorageScope.APPLICATION)
		return threads ? JSON.parse(threads) : {}
	}

	private _storeAllThreads(threads: ChatThreads) {
		this._storageService.store(THREAD_STORAGE_KEY, JSON.stringify(threads), StorageScope.APPLICATION, StorageTarget.USER)
	}

	// this should be the only place this.state = ... appears besides constructor
	private _setState(state: Partial<ThreadsState>, affectsCurrent: boolean) {
		this.state = {
			...this.state,
			...state
		}
		if (affectsCurrent)
			this._onDidChangeCurrentThread.fire()
	}

	private _setStreamState(threadId: string, state: Partial<NonNullable<ThreadStreamState[string]>>) {
		this.streamState[threadId] = {
			...this.streamState[threadId],
			...state
		}
		this._onDidChangeStreamState.fire({ threadId })
	}


	// ---------- streaming ----------

	finishStreaming = (threadId: string, content: string, error?: { message: string, fullError: Error | null }) => {
		// add assistant's message to chat history, and clear selection
		const assistantHistoryElt: ChatMessage = { role: 'assistant', content, displayContent: content || null }
		this._addMessageToThread(threadId, assistantHistoryElt)
		this._setStreamState(threadId, { messageSoFar: undefined, streamingToken: undefined, error })
	}


	async editUserMessageAndStreamResponse(userMessage: string, messageIdx: number) {

		const thread = this.getCurrentThread()

		const messageToReplace = thread.messages[messageIdx]
		if (messageToReplace?.role !== 'user') {
			console.log(`Error: tried to edit non-user message. messageIdx=${messageIdx}, numMessages=${thread.messages.length}`)
			return
		}

		// clear messages up to the index
		const slicedMessages = thread.messages.slice(0, messageIdx)
		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: {
					...thread,
					messages: slicedMessages
				}
			}
		}, true)

		// stream the edit
		this.addUserMessageAndStreamResponse(userMessage, messageToReplace.stagingSelections)

	}

	async addUserMessageAndStreamResponse(userMessage: string, selectionsOverride?: StagingSelectionItem[] | null) {


		const thread = this.getCurrentThread()
		const threadId = thread.id

		let defaultThreadSelections = thread.stagingSelections

		const currSelns = selectionsOverride ?? defaultThreadSelections ?? [] // don't use _useFocusedStagingState to avoid race conditions with focusing

		// add user's message to chat history
		const instructions = userMessage
		const content = await chat_userMessage(instructions, currSelns, this._modelService)
		const userHistoryElt: ChatMessage = { role: 'user', content: content, displayContent: instructions, selections: currSelns, stagingSelections: [], }
		this._addMessageToThread(threadId, userHistoryElt)

		this._setStreamState(threadId, { error: undefined })

		const llmCancelToken = this._llmMessageService.sendLLMMessage({
			type: 'sendChatMessage',
			logging: { loggingName: 'Chat' },
			useProviderFor: 'Ctrl+L',
			messages: [
				{ role: 'system', content: chat_systemMessage },
				...this.getCurrentThread().messages.map(m => ({ role: m.role, content: m.content || '(null)' })),
			],
			onText: ({ newText, fullText }) => {
				console.log('onText', fullText)
				this._setStreamState(threadId, { messageSoFar: fullText })
			},
			onFinalMessage: ({ fullText: content }) => {
				console.log('finalMessage', JSON.stringify(content))
				this.finishStreaming(threadId, content)
			},
			onError: (error) => {
				console.log('onError', content)
				this.finishStreaming(threadId, this.streamState[threadId]?.messageSoFar ?? '', error)
			},

		})
		if (llmCancelToken === null) return
		this._setStreamState(threadId, { streamingToken: llmCancelToken })

	}

	cancelStreaming(threadId: string) {
		const llmCancelToken = this.streamState[threadId]?.streamingToken
		if (llmCancelToken !== undefined) this._llmMessageService.abort(llmCancelToken)
		this.finishStreaming(threadId, this.streamState[threadId]?.messageSoFar ?? '')
	}

	dismissStreamError(threadId: string): void {
		this._setStreamState(threadId, { error: undefined })
	}



	// ---------- the rest ----------

	getCurrentThread(): ChatThreads[string] {
		const state = this.state
		return state.allThreads[state.currentThreadId]
	}

	getFocusedMessageIdx() {
		const thread = this.getCurrentThread()
		return thread.focusedMessageIdx
	}

	switchToThread(threadId: string) {
		// console.log('threadId', threadId)
		// console.log('messages', this.state.allThreads[threadId].messages)
		this._setState({ currentThreadId: threadId }, true)
	}


	openNewThread() {
		// if a thread with 0 messages already exists, switch to it
		const { allThreads: currentThreads } = this.state
		for (const threadId in currentThreads) {
			if (currentThreads[threadId].messages.length === 0) {
				this.switchToThread(threadId)
				return
			}
		}
		// otherwise, start a new thread
		const newThread = newThreadObject()

		// update state
		const newThreads: ChatThreads = {
			...currentThreads,
			[newThread.id]: newThread
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads, currentThreadId: newThread.id }, true)
	}


	_addMessageToThread(threadId: string, message: ChatMessage) {
		const { allThreads } = this.state

		const oldThread = allThreads[threadId]

		// update state and store it
		const newThreads = {
			...allThreads,
			[oldThread.id]: {
				...oldThread,
				lastModified: new Date().toISOString(),
				messages: [...oldThread.messages, message],
			}
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads }, true) // the current thread just changed (it had a message added to it)
	}

	// sets the currently selected message (must be undefined if no message is selected)
	setFocusedMessageIdx(messageIdx: number | undefined) {

		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					focusedMessageIdx: messageIdx
				}
			}
		}, true)
	}

	// set thread.messages[messageIdx].stagingSelections
	private setEditMessageStagingSelections(stagingSelections: StagingSelectionItem[], messageIdx: number): void {

		const thread = this.getCurrentThread()
		const message = thread.messages[messageIdx]
		if (message.role !== 'user') return;

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: {
					...thread,
					messages: thread.messages.map((m, i) =>
						i === messageIdx ? { ...m, stagingSelections } : m
					)
				}
			}
		}, true)

	}

	// set thread.stagingSelections
	private setDefaultStagingSelections(stagingSelections: StagingSelectionItem[]): void {


		console.log('Default1')
		const thread = this.getCurrentThread()

		console.log('Default2')

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: {
					...thread,
					stagingSelections
				}
			}
		}, true)

	}

	// gets `staging` and `setStaging` of the currently focused element, given the index of the currently selected message (or undefined if no message is selected)
	_useStagingSelectionsState(messageIdx?: number | undefined) {

		let staging: StagingSelectionItem[] = []
		let setStaging: (selections: StagingSelectionItem[]) => void = () => { }

		const thread = this.getCurrentThread()
		const isFocusingMessage = messageIdx !== undefined
		if (isFocusingMessage) { // is editing message

			const message = thread.messages[messageIdx!]
			if (message.role === 'user') {
				staging = message.stagingSelections || []
				setStaging = (s) => this.setEditMessageStagingSelections(s, messageIdx)
			}

		}
		else { // is editing the default input box
			staging = thread.stagingSelections || []
			setStaging = this.setDefaultStagingSelections.bind(this)
		}

		return [staging, setStaging] as const
	}



}

registerSingleton(IChatThreadService, ChatThreadService, InstantiationType.Eager);

