
import React, { FormEvent, useCallback, useRef, useState } from 'react';
import { useSettingsState, useSidebarState, useThreadsState, useQuickEditState, useService } from '../util/services.js';
import { OnError } from '../../../../../../../platform/void/common/llmMessageTypes.js';
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { getCmdKey } from '../../../helpers/getCmdKey.js';
import { VoidInputBox } from '../util/inputs.js';
import { QuickEditPropsType } from '../../../quickEditActions.js';

export const CtrlKChat = (props: QuickEditPropsType) => {

	const inputBoxRef: React.MutableRefObject<InputBox | null> = useRef(null);

	// -- imported state --
	// const threadsStateService = useService('service')
	// const sidebarState = useSidebarState()

	const quickEditState = useQuickEditState()


	// -- local state --
	// state of chat
	const [messageStream, setMessageStream] = useState<string | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const latestRequestIdRef = useRef<string | null>(null)
	const [latestError, setLatestError] = useState<Parameters<OnError>[0] | null>(null)


	// state of current message
	const [instructions, setInstructions] = useState('') // the user's instructions
	const onChangeText = useCallback((newStr: string) => { setInstructions(newStr) }, [setInstructions])
	const isDisabled = !instructions.trim()

	const onSubmit = useCallback((e: FormEvent) => {
		// TODO
	}, [])

	return <form
		className={
			// copied from SidebarChat.tsx
			`flex flex-col gap-2 p-1 relative input text-left shrink-0
			transition-all duration-200
			rounded-md
			bg-vscode-input-bg
			border border-vscode-commandcenter-inactive-border focus-within:border-vscode-commandcenter-active-border hover:border-vscode-commandcenter-active-border`
		}
		onKeyDown={(e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				onSubmit(e)
			}
		}}
		onSubmit={(e) => {
			console.log('submit!')
			onSubmit(e)
		}}
		onClick={(e) => {
			if (e.currentTarget === e.target) {
				inputBoxRef.current?.focus()
			}
		}}
	>
		<div
			className={
				// copied from SidebarChat.tsx
				`@@[&_textarea]:!void-bg-transparent @@[&_textarea]:!void-outline-none @@[&_textarea]:!void-text-vscode-input-fg @@[&_textarea]:!void-max-h-[100px] @@[&_div.monaco-inputbox]:!void- @@[&_div.monaco-inputbox]:!void-outline-none`
			}
		>

			{/* text input */}
			<VoidInputBox
				placeholder={`${getCmdKey()}+K to select`}
				onChangeText={onChangeText}
				inputBoxRef={inputBoxRef}
				multiline={true}
			/>
		</div>


	</form>



}
