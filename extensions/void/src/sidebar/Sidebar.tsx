import React, { useState, useEffect, useRef, useCallback, FormEvent } from "react"
import { ApiConfig, sendLLMMessage } from "../common/sendLLMMessage"
import { ChatMessage, File, Selection, WebviewMessage } from "../shared_types"
import { awaitVSCodeResponse, getVSCodeAPI, resolveAwaitingVSCodeResponse } from "./getVscodeApi"

import { marked } from 'marked';
import { MarkdownRender, BlockCode } from "./MarkdownRender";

import * as vscode from 'vscode'
import { FilesSelector, IncludedFiles } from "./components/Files";
import { useChat } from "./context";
import ThreadHistory from "./components/ThreadHistory";


const filesStr = (fullFiles: File[]) => {
	return fullFiles.map(({ filepath, content }) =>
		`
${filepath.fsPath}
\`\`\`
${content}
\`\`\``).join('\n')
}

const userInstructionsStr = (instructions: string, files: File[], selection: Selection | null) => {
	return `
${filesStr(files)}

${!selection ? '' : `
I am currently selecting this code:
\`\`\`${selection.selectionStr}\`\`\`
`}

Please edit the code following these instructions:
${instructions}

If you make a change, rewrite the entire file.
`; // TODO don't rewrite the whole file on prompt, instead rewrite it when click Apply
}


const ChatBubble = ({ chatMessage }: { chatMessage: ChatMessage }) => {

	const role = chatMessage.role
	const children = chatMessage.displayContent

	if (!children)
		return null

	let chatbubbleContents: React.ReactNode

	if (role === 'user') {
		chatbubbleContents = <>
			<IncludedFiles files={chatMessage.files} />
			{chatMessage.selection?.selectionStr && <BlockCode text={chatMessage.selection.selectionStr} hideToolbar />}
			{children}
		</>
	}
	else if (role === 'assistant') {
		const tokens = marked.lexer(children); // https://marked.js.org/using_pro#renderer
		chatbubbleContents = <MarkdownRender tokens={tokens} /> // sectionsHTML
	}


	return <div className={`${role === 'user' ? 'text-right' : 'text-left'}`}>
		<div className={`inline-block p-2 rounded-lg space-y-2 ${role === 'user' ? 'bg-vscode-input-bg text-vscode-input-fg' : ''} max-w-full`}>
			{chatbubbleContents}
		</div>
	</div>
}


// const [stateRef, setState] = useInstantState(initVal)
// setState instantly changes the value of stateRef instead of having to wait until the next render
const useInstantState = <T,>(initVal: T) => {
	const stateRef = useRef<T>(initVal)
	const [_, setS] = useState<T>(initVal)
	const setState = useCallback((newVal: T) => {
		setS(newVal);
		stateRef.current = newVal;
	}, [])
	return [stateRef as React.RefObject<T>, setState] as const // make s.current readonly - setState handles all changes
}



const Sidebar = () => {
	const {
		thread,
		addMessageToHistory,
		setPreviousThreads,
		startNewChat,
	} = useChat()

	// state of current message
	const [selection, setSelection] = useState<Selection | null>(null) // the code the user is selecting
	const [files, setFiles] = useState<vscode.Uri[]>([]) // the names of the files in the chat
	const [instructions, setInstructions] = useState('') // the user's instructions

	// state of chat
	const [messageStream, setMessageStream] = useState('')
	const [isLoading, setIsLoading] = useState(false)
	const [showThreadsHistory, setShowThreadsHistory] = useState(false)

	const abortFnRef = useRef<(() => void) | null>(null)

	const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null)

	// get Api Config on mount
	useEffect(() => {
		getVSCodeAPI().postMessage({ type: 'getApiConfig' })
	}, [])

	// Receive messages from the extension
	useEffect(() => {
		const listener = (event: MessageEvent) => {

			const m = event.data as WebviewMessage;
			// resolve any awaiting promises
			// eg. it will resolve the promise below for `await VSCodeResponse('files')`
			resolveAwaitingVSCodeResponse(m)

			// if user pressed ctrl+l, add their selection to the sidebar
			if (m.type === 'ctrl+l') {

				setSelection(m.selection)

				const filepath = m.selection.filePath

				// add file if it's not a duplicate
				if (!files.find(f => f.fsPath === filepath.fsPath)) setFiles(files => [...files, filepath])

			}
			// when get apiConfig, set
			else if (m.type === 'apiConfig') {
				setApiConfig(m.apiConfig)
			}

			// incoming thread history
			else if (m.type === 'threadHistory') {
				setPreviousThreads(m.threads)
			}

			// top navigation bar command - new chat
			else if (m.type === 'startNewChat') {
				setShowThreadsHistory(false)
				startNewChat()
			}

			// top navigation bar command - new chat
			else if (m.type === 'showPreviousChats') {
				setShowThreadsHistory(true)
			}

		}
		window.addEventListener('message', listener);
		return () => { window.removeEventListener('message', listener) }
	}, [files, selection, setPreviousThreads, startNewChat])


	const formRef = useRef<HTMLFormElement | null>(null)
	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {

		e.preventDefault()
		if (isLoading) return

		setIsLoading(true)
		setInstructions('');
		formRef.current?.reset(); // reset the form's text
		setSelection(null)
		setFiles([])

		// request file content from vscode and await response
		getVSCodeAPI().postMessage({ type: 'requestFiles', filepaths: files })
		const relevantFiles = await awaitVSCodeResponse('files')

		// add message to chat history
		const content = userInstructionsStr(instructions, relevantFiles.files, selection)
		// console.log('prompt:\n', content)
		const newHistoryElt: ChatMessage = { role: 'user', content, displayContent: instructions, selection, files }
		addMessageToHistory(newHistoryElt)

		// send message to claude
		let { abort } = sendLLMMessage({
			messages: [...thread.messages.map(m => ({ role: m.role, content: m.content })), { role: 'user', content }],
			onText: (newText, fullText) => setMessageStream(fullText),
			onFinalMessage: (content) => {

				// add assistant's message to chat history
				const newHistoryElt: ChatMessage = { role: 'assistant', content, displayContent: content, }
				addMessageToHistory(newHistoryElt)

				// clear selection
				setMessageStream('')
				setIsLoading(false)
			},
			apiConfig: apiConfig
		})
		abortFnRef.current = abort

	}

	const onStop = useCallback(() => {
		// abort claude
		abortFnRef.current?.()

		// if messageStream was not empty, add it to the history
		const llmContent = messageStream || '(canceled)'
		const newHistoryElt: ChatMessage = { role: 'assistant', displayContent: messageStream, content: llmContent }
		addMessageToHistory(newHistoryElt)

		setMessageStream('')
		setIsLoading(false)

	}, [addMessageToHistory, messageStream])

	//Clear code selection
	const clearSelection = () => {
		setSelection(null);
	};

	return <>
		<div className="flex flex-col h-screen w-full">
			{showThreadsHistory && (
				<div className="mb-2 max-h-[30vh] overflow-y-auto">
					<ThreadHistory onClose={() => setShowThreadsHistory(false)} />
				</div>
			)}
			<div className="overflow-y-auto overflow-x-hidden space-y-4">
				{/* previous messages */}
				{thread.messages.map((message, i) =>
					<ChatBubble key={i} chatMessage={message} />
				)}
				{/* message stream */}
				<ChatBubble chatMessage={{ role: 'assistant', content: messageStream, displayContent: messageStream }} />
			</div>
			{/* chatbar */}
			<div className="shrink-0 py-4">
				<div className="input">
					{/* selection */}
					{(files.length || selection?.selectionStr) && <div className="p-2 pb-0 space-y-2">
						{/* selected files */}
						<FilesSelector files={files} setFiles={setFiles} />
						{/* selected code */}
						{!!selection?.selectionStr && (
							<BlockCode className="rounded bg-vscode-sidebar-bg" text={selection.selectionStr} toolbar={(
								<button 
									onClick={clearSelection}
									className="btn btn-secondary btn-sm border border-vscode-input-border rounded"
								>
									Remove
								</button>
							)} />
						)}
					</div>}
					<form
						ref={formRef}
						className="flex flex-row items-center rounded-md p-2"
						onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) onSubmit(e) }}

						onSubmit={(e) => {
							console.log('submit!')
							e.preventDefault();
							onSubmit(e)
						}}>
						{/* input */}

						<textarea
							onChange={(e) => { setInstructions(e.target.value) }}
							className="w-full p-2 leading-tight resize-none max-h-[50vh] overflow-hidden bg-transparent border-none !outline-none"
							placeholder="Ctrl+L to select"
							rows={1}
							onInput={e => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px' }} // Adjust height dynamically
						/>
						{/* submit button */}
						{isLoading ?
							<button
								onClick={onStop}
								className="btn btn-primary rounded-r-lg max-h-10 p-2"
								type='button'
							>Stop</button>
							: <button
								className="btn btn-primary font-bold size-8 flex justify-center items-center rounded-full p-2 max-h-10"
								disabled={!instructions}
								type='submit'
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
									<line x1="12" y1="19" x2="12" y2="5"></line>
									<polyline points="5 12 12 5 19 12"></polyline>
								</svg>
							</button>
						}
					</form>
				</div>
			</div>
		</div>

	</>

}

export default Sidebar
