/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { FeatureName, ProviderName, SettingsOfProvider } from './voidSettingsTypes.js'


export const errorDetails = (fullError: Error | null): string | null => {
	if (fullError === null) {
		return null
	}
	else if (typeof fullError === 'object') {
		if (Object.keys(fullError).length === 0) return null
		return JSON.stringify(fullError, null, 2)
	}
	else if (typeof fullError === 'string') {
		return null
	}
	return null
}

export type OnText = (p: { newText: string, fullText: string }) => void
export type OnFinalMessage = (p: { fullText: string }) => void
export type OnError = (p: { message: string, fullError: Error | null }) => void
export type AbortRef = { current: (() => void) | null }

export type LLMChatMessage = {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export type _InternalLLMChatMessage = {
	role: 'user' | 'assistant';
	content: string;
}

type _InternalSendFIMMessage = {
	prefix: string;
	suffix: string;
	stopTokens: string[];
}

type SendLLMType = {
	messagesType: 'chatMessages';
	messages: LLMChatMessage[];
} | {
	messagesType: 'FIMMessage';
	messages: _InternalSendFIMMessage;
}

// service types
export type ServiceSendLLMMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	logging: { loggingName: string, };
	useProviderFor: FeatureName;
} & SendLLMType

// params to the true sendLLMMessage function
export type SendLLMMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	logging: { loggingName: string, };
	abortRef: AbortRef;

	aiInstructions: string;

	providerName: ProviderName;
	modelName: string;
	settingsOfProvider: SettingsOfProvider;
} & SendLLMType



// can't send functions across a proxy, use listeners instead
export type BlockedMainLLMMessageParams = 'onText' | 'onFinalMessage' | 'onError' | 'abortRef'
export type MainSendLLMMessageParams = Omit<SendLLMMessageParams, BlockedMainLLMMessageParams> & { requestId: string } & SendLLMType

export type MainLLMMessageAbortParams = { requestId: string }

export type EventLLMMessageOnTextParams = Parameters<OnText>[0] & { requestId: string }
export type EventLLMMessageOnFinalMessageParams = Parameters<OnFinalMessage>[0] & { requestId: string }
export type EventLLMMessageOnErrorParams = Parameters<OnError>[0] & { requestId: string }


export type _InternalSendLLMChatMessageFnType = (
	params: {
		onText: OnText;
		onFinalMessage: OnFinalMessage;
		onError: OnError;
		providerName: ProviderName;
		settingsOfProvider: SettingsOfProvider;
		modelName: string;
		_setAborter: (aborter: () => void) => void;

		messages: _InternalLLMChatMessage[];
	}
) => void

export type _InternalSendLLMFIMMessageFnType = (
	params: {
		onText: OnText;
		onFinalMessage: OnFinalMessage;
		onError: OnError;
		providerName: ProviderName;
		settingsOfProvider: SettingsOfProvider;
		modelName: string;
		_setAborter: (aborter: () => void) => void;

		messages: _InternalSendFIMMessage;
	}
) => void

// service -> main -> internal -> event (back to main)
// (browser)









// These are from 'ollama' SDK
interface OllamaModelDetails {
	parent_model: string;
	format: string;
	family: string;
	families: string[];
	parameter_size: string;
	quantization_level: string;
}

export type OllamaModelResponse = {
	name: string;
	modified_at: Date;
	size: number;
	digest: string;
	details: OllamaModelDetails;
	expires_at: Date;
	size_vram: number;
}

export type OpenaiCompatibleModelResponse = {
	id: string;
	created: number;
	object: 'model';
	owned_by: string;
}


// params to the true list fn
export type ModelListParams<modelResponse> = {
	settingsOfProvider: SettingsOfProvider;
	onSuccess: (param: { models: modelResponse[] }) => void;
	onError: (param: { error: string }) => void;
}

// params to the service
export type ServiceModelListParams<modelResponse> = {
	onSuccess: (param: { models: modelResponse[] }) => void;
	onError: (param: { error: any }) => void;
}

type BlockedMainModelListParams = 'onSuccess' | 'onError'
export type MainModelListParams<modelResponse> = Omit<ModelListParams<modelResponse>, BlockedMainModelListParams> & { requestId: string }

export type EventModelListOnSuccessParams<modelResponse> = Parameters<ModelListParams<modelResponse>['onSuccess']>[0] & { requestId: string }
export type EventModelListOnErrorParams<modelResponse> = Parameters<ModelListParams<modelResponse>['onError']>[0] & { requestId: string }




export type _InternalModelListFnType<modelResponse> = (params: ModelListParams<modelResponse>) => void
