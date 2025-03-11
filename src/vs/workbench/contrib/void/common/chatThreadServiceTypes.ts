import { URI } from '../../../../base/common/uri.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { AnthropicReasoning } from './sendLLMMessageTypes.js';
import { ToolName, ToolCallParams, ToolResultType } from './toolsServiceTypes.js';

export type ToolMessage<T extends ToolName> = {
	role: 'tool';
	name: T; // internal use
	paramsStr: string; // internal use
	id: string; // apis require this tool use id
	content: string; // give this result to LLM
	result: { type: 'success'; params: ToolCallParams[T]; value: ToolResultType[T], } | { type: 'error'; params: ToolCallParams[T] | undefined; value: string }; // give this result to user
}
export type ToolRequestApproval<T extends ToolName> = {
	role: 'tool_request';
	name: T; // internal use
	params: ToolCallParams[T]; // internal use
	voidToolId: string; // internal id Void uses
}

// WARNING: changing this format is a big deal!!!!!! need to migrate old format to new format on users' computers so people don't get errors.
export type ChatMessage =
	| {
		role: 'user';
		content: string; // content displayed to the LLM on future calls - allowed to be '', will be replaced with (empty)
		displayContent: string | null; // content displayed to user  - allowed to be '', will be ignored
		selections: StagingSelectionItem[] | null; // the user's selection
		state: {
			stagingSelections: StagingSelectionItem[];
			isBeingEdited: boolean;
		}
	} | {
		role: 'assistant';
		content: string; // content received from LLM  - allowed to be '', will be replaced with (empty)
		reasoning: string; // reasoning from the LLM, used for step-by-step thinking

		anthropicReasoning: AnthropicReasoning[] | null; // anthropic reasoning
	}
	| ToolMessage<ToolName>
	| ToolRequestApproval<ToolName>


// one of the square items that indicates a selection in a chat bubble (NOT a file, a Selection of text)
export type CodeSelection = {
	type: 'Selection';
	fileURI: URI;
	selectionStr: string;
	range: IRange;
	state: {
		isOpened: boolean;
	};
}

export type FileSelection = {
	type: 'File';
	fileURI: URI;
	selectionStr: null;
	range: null;
	state: {
		isOpened: boolean;
	};
}

export type StagingSelectionItem = CodeSelection | FileSelection



export type CodespanLocationLink = {
	uri: URI, // we handle serialization for this
	selection?: { // store as JSON so dont have to worry about serialization
		startLineNumber: number
		startColumn: number,
		endLineNumber: number
		endColumn: number,
	} | undefined
} | null
