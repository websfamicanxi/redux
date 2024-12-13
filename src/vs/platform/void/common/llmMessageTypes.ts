/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { IRange } from '../../../editor/common/core/range'
import { ProviderName, SettingsOfProvider } from './voidConfigTypes'


export type OnText = (p: { newText: string, fullText: string }) => void
export type OnFinalMessage = (p: { fullText: string }) => void
export type OnError = (p: { message: string, fullError: Error | null }) => void
export type AbortRef = { current: (() => void) | null }

export type LLMMessage = {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export type LLMFeatureSelection = {
	featureName: 'Ctrl+K',
	range: IRange
} | {
	featureName: 'Ctrl+L',
} | {
	featureName: 'Autocomplete',
	range: IRange
}

// params to the true sendLLMMessage function
export type LLMMMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	abortRef: AbortRef;

	messages: LLMMessage[];

	logging: {
		loggingName: string,
	};
	providerName: ProviderName;
	modelName: string;
	settingsOfProvider: SettingsOfProvider;
}

export type ServiceSendLLMMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;

	messages: LLMMessage[];

	logging: {
		loggingName: string,
	};
} & LLMFeatureSelection

// can't send functions across a proxy, use listeners instead
export type BlockedMainLLMMessageParams = 'onText' | 'onFinalMessage' | 'onError' | 'abortRef'

export type MainLLMMessageParams = Omit<LLMMMessageParams, BlockedMainLLMMessageParams> & { requestId: string }
export type MainLLMMessageAbortParams = { requestId: string }

export type EventLLMMessageOnTextParams = Parameters<OnText>[0] & { requestId: string }
export type EventLLMMessageOnFinalMessageParams = Parameters<OnFinalMessage>[0] & { requestId: string }
export type EventLLMMessageOnErrorParams = Parameters<OnError>[0] & { requestId: string }

export type _InternalSendLLMMessageFnType = (params: {
	messages: LLMMessage[];
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	settingsOfProvider: SettingsOfProvider;
	providerName: ProviderName;
	modelName: string;

	_setAborter: (aborter: () => void) => void;
}) => void

// service -> main -> internal -> event (back to main)
// (browser)
















// These are from 'ollama' SDK
interface ModelDetails {
	parent_model: string;
	format: string;
	family: string;
	families: string[];
	parameter_size: string;
	quantization_level: string;
}

type ModelResponse = {
	name: string;
	modified_at: Date;
	size: number;
	digest: string;
	details: ModelDetails;
	expires_at: Date;
	size_vram: number;
}


// params to the true list fn
export type OllamaListParams = {
	settingsOfProvider: SettingsOfProvider;
	onSuccess: (param: { models: ModelResponse[] }) => void;
	onError: (param: { error: any }) => void;
}

export type ServiceOllamaListParams = {
	onSuccess: (param: { models: ModelResponse[] }) => void;
	onError: (param: { error: any }) => void;
}

type BlockedMainOllamaListParams = 'onSuccess' | 'onError'
export type MainOllamaListParams = Omit<OllamaListParams, BlockedMainOllamaListParams> & { requestId: string }

export type EventOllamaListOnSuccessParams = Parameters<OllamaListParams['onSuccess']>[0] & { requestId: string }
export type EventOllamaListOnErrorParams = Parameters<OllamaListParams['onError']>[0] & { requestId: string }



export type _InternalOllamaListFnType = (params: OllamaListParams) => void
