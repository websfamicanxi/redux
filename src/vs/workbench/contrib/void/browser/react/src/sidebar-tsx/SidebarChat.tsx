/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { ButtonHTMLAttributes, FormEvent, FormHTMLAttributes, Fragment, useCallback, useEffect, useRef, useState } from 'react';


import { useAccessor, useSidebarState, useChatThreadsState, useChatThreadsStreamState } from '../util/services.js';
import { ChatMessage, CodeSelection, CodeStagingSelection } from '../../../chatThreadService.js';

import { BlockCode } from '../markdown/BlockCode.js';
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { EndOfLinePreference } from '../../../../../../../editor/common/model.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { ErrorDisplay } from './ErrorDisplay.js';
import { OnError, ServiceSendLLMMessageParams } from '../../../../../../../platform/void/common/llmMessageTypes.js';
import { HistoryInputBox, InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { TextAreaFns, VoidCodeEditorProps, VoidInputBox2 } from '../util/inputs.js';
import { ModelDropdown } from '../void-settings-tsx/ModelDropdown.js';
import { chat_systemMessage, chat_prompt } from '../../../prompt/prompts.js';
import { ISidebarStateService } from '../../../sidebarStateService.js';
import { ILLMMessageService } from '../../../../../../../platform/void/common/llmMessageService.js';
import { IModelService } from '../../../../../../../editor/common/services/model.js';
import { SidebarThreadSelector } from './SidebarThreadSelector.js';
import { useScrollbarStyles } from '../util/useScrollbarStyles.js';
import { VOID_CTRL_L_ACTION_ID } from '../../../actionIDs.js';
import { ArrowBigLeftDash, CopyX, Delete, FileX2, SquareX, X } from 'lucide-react';
import { filenameToVscodeLanguage } from '../../../helpers/detectLanguage.js';
import { Pencil } from 'lucide-react'


export const IconX = ({ size, className = '', ...props }: { size: number, className?: string } & React.SVGProps<SVGSVGElement>) => {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			width={size}
			height={size}
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			className={className}
			{...props}
		>
			<path
				strokeLinecap='round'
				strokeLinejoin='round'
				d='M6 18 18 6M6 6l12 12'
			/>
		</svg>
	);
};

const IconArrowUp = ({ size, className = '' }: { size: number, className?: string }) => {
	return (
		<svg
			width={size}
			height={size}
			className={className}
			viewBox="0 0 20 20"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				fill="black"
				fillRule="evenodd"
				clipRule="evenodd"
				d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z"
			></path>
		</svg>
	);
};


const IconSquare = ({ size, className = '' }: { size: number, className?: string }) => {
	return (
		<svg
			className={className}
			stroke="black"
			fill="black"
			strokeWidth="0"
			viewBox="0 0 24 24"
			width={size}
			height={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<rect x="2" y="2" width="20" height="20" rx="4" ry="4" />
		</svg>
	);
};


export const IconWarning = ({ size, className = '' }: { size: number, className?: string }) => {
	return (
		<svg
			className={className}
			stroke="currentColor"
			fill="currentColor"
			strokeWidth="0"
			viewBox="0 0 16 16"
			width={size}
			height={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M7.56 1h.88l6.54 12.26-.44.74H1.44L1 13.26 7.56 1zM8 2.28L2.28 13H13.7L8 2.28zM8.625 12v-1h-1.25v1h1.25zm-1.25-2V6h1.25v4h-1.25z"
			/>
		</svg>
	);
};


export const IconLoading = ({ className = '' }: { className?: string }) => {

	const [loadingText, setLoadingText] = useState('.');

	useEffect(() => {
		let intervalId;

		// Function to handle the animation
		const toggleLoadingText = () => {
			if (loadingText === '...') {
				setLoadingText('.');
			} else {
				setLoadingText(loadingText + '.');
			}
		};

		// Start the animation loop
		intervalId = setInterval(toggleLoadingText, 300);

		// Cleanup function to clear the interval when component unmounts
		return () => clearInterval(intervalId);
	}, [loadingText, setLoadingText]);

	return <div className={`${className}`}>{loadingText}</div>;

}

const useResizeObserver = () => {
	const ref = useRef(null);
	const [dimensions, setDimensions] = useState({ height: 0, width: 0 });

	useEffect(() => {
		if (ref.current) {
			const resizeObserver = new ResizeObserver((entries) => {
				if (entries.length > 0) {
					const entry = entries[0];
					setDimensions({
						height: entry.contentRect.height,
						width: entry.contentRect.width
					});
				}
			});

			resizeObserver.observe(ref.current);

			return () => {
				if (ref.current)
					resizeObserver.unobserve(ref.current);
			};
		}
	}, []);

	return [ref, dimensions] as const;
};




type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>
const DEFAULT_BUTTON_SIZE = 22;
export const ButtonSubmit = ({ className, disabled, ...props }: ButtonProps & Required<Pick<ButtonProps, 'disabled'>>) => {

	return <button
		type='button'
		className={`rounded-full flex-shrink-0 flex-grow-0 flex items-center justify-center
			${disabled ? 'bg-vscode-disabled-fg cursor-default' : 'bg-white cursor-pointer'}
			${className}
		`}
		{...props}
	>
		<IconArrowUp size={DEFAULT_BUTTON_SIZE} className="stroke-[2] p-[2px]" />
	</button>
}

export const ButtonStop = ({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => {

	return <button
		className={`rounded-full flex-shrink-0 flex-grow-0 cursor-pointer flex items-center justify-center
			bg-white
			${className}
		`}
		type='button'
		{...props}
	>
		<IconSquare size={DEFAULT_BUTTON_SIZE} className="stroke-[3] p-[7px]" />
	</button>
}


const ScrollToBottomContainer = ({ children, className, style, scrollContainerRef }: { children: React.ReactNode, className?: string, style?: React.CSSProperties, scrollContainerRef: React.MutableRefObject<HTMLDivElement | null> }) => {
	const [isAtBottom, setIsAtBottom] = useState(true); // Start at bottom

	const divRef = scrollContainerRef

	const scrollToBottom = () => {
		if (divRef.current) {
			divRef.current.scrollTop = divRef.current.scrollHeight;
		}
	};

	const onScroll = () => {
		const div = divRef.current;
		if (!div) return;

		const isBottom = Math.abs(
			div.scrollHeight - div.clientHeight - div.scrollTop
		) < 4;

		setIsAtBottom(isBottom);
	};

	// When children change (new messages added)
	useEffect(() => {
		if (isAtBottom) {
			scrollToBottom();
		}
	}, [children, isAtBottom]); // Dependency on children to detect new messages

	// Initial scroll to bottom
	useEffect(() => {
		scrollToBottom();
	}, []);

	return (
		<div
			// options={{ vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Auto }}
			ref={divRef}
			onScroll={onScroll}
			className={className}
			style={style}
		>
			{children}
		</div>
	);
};



const getBasename = (pathStr: string) => {
	// 'unixify' path
	pathStr = pathStr.replace(/[/\\]+/g, '/') // replace any / or \ or \\ with /
	const parts = pathStr.split('/') // split on /
	return parts[parts.length - 1]
}

export const SelectedFiles = (
	{ type, selections, setStaging }:
		| { type: 'past', selections: CodeSelection[] | null; setStaging?: undefined }
		| { type: 'staging', selections: CodeStagingSelection[] | null; setStaging: ((files: CodeStagingSelection[]) => void) }
) => {

	// index -> isOpened
	const [selectionIsOpened, setSelectionIsOpened] = useState<(boolean)[]>(selections?.map(() => false) ?? [])

	// state for tracking hover on clear all button
	const [isClearHovered, setIsClearHovered] = useState(false)

	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')

	return (
		!!selections && selections.length !== 0 && (
			<div
				className='flex items-center flex-wrap gap-0.5 text-left relative'
			>
				{selections.map((selection, i) => {

					const isThisSelectionOpened = !!(selection.selectionStr && selectionIsOpened[i])
					const isThisSelectionAFile = selection.selectionStr === null

					return <div key={i} // container for `selectionSummary` and `selectionText`
						className={`${isThisSelectionOpened ? 'w-full' : ''}`}
					>
						{/* selection summary */}
						<div // container for delete button
							className='flex items-center gap-0.5'
						>
							<div // styled summary box
								className={`flex items-center gap-0.5 relative
									rounded-md px-1
									w-fit h-fit
									select-none
									bg-void-bg-3 hover:brightness-95
									text-void-fg-1 text-xs text-nowrap
									border rounded-xs ${isClearHovered ? 'border-void-border-1' : 'border-void-border-2'} hover:border-void-border-1
									transition-all duration-150`}
								onClick={() => {
									// open the file if it is a file
									if (isThisSelectionAFile) {
										commandService.executeCommand('vscode.open', selection.fileURI, {
											preview: true,
											// preserveFocus: false,
										});
									} else {
										// open the selection if it is a text-selection
										setSelectionIsOpened(s => {
											const newS = [...s]
											newS[i] = !newS[i]
											return newS
										});
									}
								}}
							>
								<span>
									{/* file name */}
									{getBasename(selection.fileURI.fsPath)}
									{/* selection range */}
									{!isThisSelectionAFile ? ` (${selection.range.startLineNumber}-${selection.range.endLineNumber})` : ''}
								</span>

								{/* X button */}
								{type === 'staging' &&
									<span
										className='cursor-pointer hover:brightness-95 rounded-md z-1'
										onClick={(e) => {
											e.stopPropagation(); // don't open/close selection
											if (type !== 'staging') return;
											setStaging([...selections.slice(0, i), ...selections.slice(i + 1)])
											setSelectionIsOpened(o => [...o.slice(0, i), ...o.slice(i + 1)])
										}}
									>
										<IconX size={16} className="p-[2px] stroke-[3]" />
									</span>}


							</div>

							{/* clear all selections button */}
							{type !== 'staging' || selections.length === 0 || i !== selections.length - 1
								? null
								: <div key={i} className={`flex items-center gap-0.5 ${isThisSelectionOpened ? 'w-full' : ''}`}>
									<div
										className='rounded-md'
										onMouseEnter={() => setIsClearHovered(true)}
										onMouseLeave={() => setIsClearHovered(false)}
									>
										<Delete
											size={16}
											className={`stroke-[1]
												stroke-void-fg-1
												fill-void-bg-3
												opacity-40
												hover:opacity-60
												transition-all duration-150
												cursor-pointer
											`}
											onClick={() => { setStaging([]) }}
										/>
									</div>
								</div>
							}
						</div>
						{/* selection text */}
						{isThisSelectionOpened &&
							<div
								className='w-full px-1 rounded-sm border-vscode-editor-border'
								onClick={(e) => {
									e.stopPropagation(); // don't focus input box
								}}
							>
								<BlockCode
									initValue={selection.selectionStr!}
									language={filenameToVscodeLanguage(selection.fileURI.path)}
									maxHeight={200}
									showScrollbars={true}
								/>
							</div>
						}
					</div>

				})}


			</div>
		)
	)
}



const ChatBubble = ({ chatMessage, isLoading }: {
	chatMessage: ChatMessage,
	isLoading?: boolean,
}) => {

	const role = chatMessage.role

	// edit mode state
	const [isEditMode, setIsEditMode] = useState(false)

	if (!chatMessage.displayContent)
		return null

	let chatbubbleContents: React.ReactNode

	if (role === 'user') {
		chatbubbleContents = <>
			<SelectedFiles type='past' selections={chatMessage.selections} />
			{chatMessage.displayContent}

			{/* {!isEditMode ? chatMessage.displayContent : <></>} */}
			{/* edit mode content */}
			{/* TODO this should be the same input box as in the Sidebar */}
			{/* <textarea
				value={editModeText}
				className={`
						w-full max-w-full
						h-auto min-h-[81px] max-h-[500px]
						bg-void-bg-1 resize-none
					`}
				style={{ marginTop: 0 }}
				hidden={!isEditMode}
			/> */}

		</>
	}
	else if (role === 'assistant') {
		chatbubbleContents = <ChatMarkdownRender string={chatMessage.displayContent} />
	}

	return <div
		// align chatbubble accoridng to role
		className={`
            relative
			${isEditMode ? 'px-2 w-full max-w-full'
				: role === 'user' ? `px-2 self-end w-fit max-w-full`
					: role === 'assistant' ? `px-2 self-start w-full max-w-full` : ''
			}
        `}
	>
		<div
			// style chatbubble according to role
			className={`
                p-2 text-left space-y-2 rounded-lg
                overflow-x-auto max-w-full
                ${role === 'user' ? 'bg-void-bg-1 text-void-fg-1' : ''}
            `}
		>
			{chatbubbleContents}
			{isLoading && <IconLoading className='opacity-50 text-sm' />}
		</div>

		{/* edit button */}
		{/* {role === 'user' &&
			<Pencil
				size={16}
				className={`
					absolute top-0 right-2
					translate-x-0 -translate-y-0
					cursor-pointer z-1
				`}
				onClick={() => { setIsEditMode(v => !v); }}
			/>
		} */}
	</div>
}


export const SidebarChat = () => {

	const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
	const textAreaFnsRef = useRef<TextAreaFns | null>(null)

	const accessor = useAccessor()
	const modelService = accessor.get('IModelService')

	// ----- HIGHER STATE -----
	// sidebar state
	const sidebarStateService = accessor.get('ISidebarStateService')
	useEffect(() => {
		const disposables: IDisposable[] = []
		disposables.push(
			sidebarStateService.onDidFocusChat(() => { textAreaRef.current?.focus() }),
			sidebarStateService.onDidBlurChat(() => { textAreaRef.current?.blur() })
		)
		return () => disposables.forEach(d => d.dispose())
	}, [sidebarStateService, textAreaRef])

	const { isHistoryOpen } = useSidebarState()

	// threads state
	const chatThreadsState = useChatThreadsState()
	const chatThreadsService = accessor.get('IChatThreadService')

	const currentThread = chatThreadsService.getCurrentThread()
	const previousMessages = currentThread?.messages ?? []
	const selections = chatThreadsState.currentStagingSelections

	// stream state
	const chatThreadsStreamState = useChatThreadsStreamState(chatThreadsState.currentThreadId)
	const isCurrThreadStreaming = !!chatThreadsStreamState?.streamingToken
	const latestError = chatThreadsStreamState?.error
	const messageSoFar = chatThreadsStreamState?.messageSoFar

	// ----- SIDEBAR CHAT state (local) -----

	// state of current message
	const initVal = ''
	const [instructionsAreEmpty, setInstructionsAreEmpty] = useState(!initVal)
	const isDisabled = instructionsAreEmpty

	const [sidebarRef, sidebarDimensions] = useResizeObserver()
	const [formRef, formDimensions] = useResizeObserver()
	const [historyRef, historyDimensions] = useResizeObserver()

	useScrollbarStyles(sidebarRef)


	const onSubmit = async () => {

		if (isDisabled) return
		if (isCurrThreadStreaming) return

		// send message to LLM
		const userMessage = textAreaRef.current?.value ?? ''
		await chatThreadsService.addUserMessageAndStreamResponse(userMessage)

		chatThreadsService.setStaging([]) // clear staging
		textAreaFnsRef.current?.setValue('')
		textAreaRef.current?.focus() // focus input after submit

	}

	const onAbort = () => {
		const token = chatThreadsStreamState?.streamingToken
		if (!token) return
		chatThreadsService.cancelStreaming(token)
	}

	// const [_test_messages, _set_test_messages] = useState<string[]>([])

	const keybindingString = accessor.get('IKeybindingService').lookupKeybinding(VOID_CTRL_L_ACTION_ID)?.getLabel()

	// scroll to top on thread switch
	const scrollContainerRef = useRef<HTMLDivElement | null>(null)
	useEffect(() => {
		if (isHistoryOpen)
			scrollContainerRef.current?.scrollTo({ top: 0, left: 0 })
	}, [isHistoryOpen, currentThread.id])

	return <div
		ref={sidebarRef}
		className={`w-full h-full`}
	>
		{/* thread selector */}
		<div ref={historyRef}
			className={`w-full h-auto ${isHistoryOpen ? '' : 'hidden'} ring-2 ring-widget-shadow ring-inset z-10`}
		>
			<SidebarThreadSelector />
		</div>

		{/* previous messages + current stream */}
		<ScrollToBottomContainer
			scrollContainerRef={scrollContainerRef}
			className={`
				w-full h-auto
				flex flex-col gap-0
				overflow-x-hidden
				overflow-y-auto
			`}
			style={{ maxHeight: sidebarDimensions.height - historyDimensions.height - formDimensions.height - 30 }} // the height of the previousMessages is determined by all other heights
		>
			{/* previous messages */}
			{previousMessages.map((message, i) =>
				<ChatBubble key={i} chatMessage={message} />
			)}

			{/* message stream */}
			<ChatBubble chatMessage={{ role: 'assistant', content: messageSoFar ?? '', displayContent: messageSoFar || null }} isLoading={isCurrThreadStreaming} />

		</ScrollToBottomContainer>


		{/* input box */}
		<div // this div is used to position the input box properly
			className={`right-0 left-0 m-2 z-[999] overflow-hidden ${previousMessages.length > 0 ? 'absolute bottom-0' : ''}`}
		>
			<div
				ref={formRef}
				className={`
					flex flex-col gap-2 p-2 relative input text-left shrink-0
					transition-all duration-200
					rounded-md
					bg-vscode-input-bg
					max-h-[80vh] overflow-y-auto
					border border-void-border-3 focus-within:border-void-border-1 hover:border-void-border-1
				`}
				onClick={(e) => {
					textAreaRef.current?.focus()
				}}
			>
				{/* top row */}
				<>
					{/* selections */}
					{(selections && selections.length !== 0) &&
						<SelectedFiles type='staging' selections={selections} setStaging={chatThreadsService.setStaging.bind(chatThreadsService)} />
					}

					{/* error message */}
					{latestError === undefined ? null :
						<ErrorDisplay
							message={latestError.message}
							fullError={latestError.fullError}
							onDismiss={() => { chatThreadsService.dismissStreamError(currentThread.id) }}
							showDismiss={true}
						/>
					}
				</>

				{/* middle row */}
				<div>

					{/* text input */}
					<VoidInputBox2
						className='min-h-[81px] p-1'
						placeholder={`${keybindingString} to select. Enter instructions...`}
						onChangeText={useCallback((newStr: string) => { setInstructionsAreEmpty(!newStr) }, [setInstructionsAreEmpty])}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && !e.shiftKey) {
								onSubmit()
							}
						}}
						ref={textAreaRef}
						fnsRef={textAreaFnsRef}
						multiline={true}
					/>
				</div>

				{/* bottom row */}
				<div
					className='flex flex-row justify-between items-end gap-1'
				>
					{/* submit options */}
					<div className='max-w-[150px]
						@@[&_select]:!void-border-none
						@@[&_select]:!void-outline-none
						flex-grow
						'
					>
						<ModelDropdown featureName='Ctrl+L' />
					</div>

					{/* submit / stop button */}
					{isCurrThreadStreaming ?
						// stop button
						<ButtonStop
							onClick={onAbort}
						/>
						:
						// submit button (up arrow)
						<ButtonSubmit
							onClick={onSubmit}
							disabled={isDisabled}
						/>
					}
				</div>


			</div>
		</div >
	</div >
}


