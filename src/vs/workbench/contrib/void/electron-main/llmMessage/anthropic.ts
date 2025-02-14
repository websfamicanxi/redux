/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import { _InternalSendLLMChatMessageFnType } from '../../common/llmMessageTypes.js';
import { anthropicMaxPossibleTokens } from '../../common/voidSettingsTypes.js';
import { InternalToolInfo } from '../../common/toolsService.js';




export const toAnthropicTool = (toolName: string, toolInfo: InternalToolInfo) => {
	const { description, params, required } = toolInfo
	return {
		name: toolName,
		description: description,
		input_schema: {
			type: 'object',
			properties: params,
			required: required,
		}
	} satisfies Anthropic.Messages.Tool
}





export const sendAnthropicChat: _InternalSendLLMChatMessageFnType = ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }) => {

	const thisConfig = settingsOfProvider.anthropic

	const maxTokens = anthropicMaxPossibleTokens(modelName)
	if (maxTokens === undefined) {
		onError({ message: `Please set a value for Max Tokens.`, fullError: null })
		return
	}

	const anthropic = new Anthropic({ apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true });

	const stream = anthropic.messages.stream({
		// system: systemMessage,
		messages: messages,
		model: modelName,
		max_tokens: maxTokens,
	});


	// when receive text
	stream.on('text', (newText, fullText) => {
		onText({ newText, fullText })
	})


	// can do tool use streaming
	const toolCallOfIndex: { [index: string]: { name: string, args: string } } = {}
	stream.on('streamEvent', e => {
		if (e.type === 'content_block_start') {
			if (e.content_block.type !== 'tool_use') return
			const index = e.index
			const tool = e.content_block
			if (!toolCallOfIndex[index])
				toolCallOfIndex[index] = { name: '', args: '' }
			toolCallOfIndex[index].name += tool.name ?? ''
			toolCallOfIndex[index].args += tool.input ?? ''

		}
		else if (e.type === 'content_block_delta') {
			if (e.delta.type !== 'input_json_delta') return
			toolCallOfIndex[e.index].args += e.delta.partial_json
		}
		// TODO!!!!!
		// onText({})
	})

	// when we get the final message on this stream (or when error/fail)
	stream.on('finalMessage', (response) => {
		// stringify the response's content
		const content = response.content.map(c => c.type === 'text' ? c.text : '').join('\n')
		const tools = response.content.map(c => c.type === 'tool_use' ? { name: c.name, input: c.input } : null)

		console.log("TOOLS!!!!", typeof tools[0]?.input, JSON.stringify(tools, null, 2))

		onFinalMessage({ fullText: content, })
	})

	stream.on('error', (error) => {
		// the most common error will be invalid API key (401), so we handle this with a nice message
		if (error instanceof Anthropic.APIError && error.status === 401) {
			onError({ message: 'Invalid API key.', fullError: error })
		}
		else {
			onError({ message: error + '', fullError: error }) // anthropic errors can be stringified nicely like this
		}
	})

	// TODO need to test this to make sure it works, it might throw an error
	_setAborter(() => stream.controller.abort())

};
