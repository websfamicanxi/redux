
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/



// const voidProviderDefaults = {
// 	"ctrl+L":{
// 		models:[ // select only if present
// 			{
// 				provider:"anthropic",
// 				model:"claude-3-5-sonnet-20240620"
// 			},
// 		]
// 	},
// }



export const voidProviderDefaults = {
	anthropic: {
		apiKey: '',
	},
	openAI: {
		apiKey: '',
	},
	ollama: {
		endpoint: 'http://127.0.0.1:11434',
	},
	openRouter: {
		apiKey: '',
	},
	openAICompatible: {
		apiKey: '',
		endpoint: '',
	},
	gemini: {
		apiKey: '',
	},
	groq: {
		apiKey: ''
	}
} as const


export const dummyModelData = {
	anthropic: ['claude 3.5'],
	openAI: ['gpt 4o'],
	ollama: ['llama 3.2'],
	openRouter: ['qwen 2.5'],
}




export const voidInitModelOptions = {
	anthropic: () => ({
		// model: 'claude-3-5-sonnet-20240620',
		models: [
			'claude-3-5-sonnet-20240620',
			'claude-3-opus-20240229',
			'claude-3-sonnet-20240229',
			'claude-3-haiku-20240307'
		],
	}),
	openAI: () => ({
		// model: 'gpt-4o',
		models: [
			'o1-preview',
			'o1-mini',
			'gpt-4o',
			'gpt-4o-2024-05-13',
			'gpt-4o-2024-08-06',
			'gpt-4o-mini',
			'gpt-4o-mini-2024-07-18',
			'gpt-4-turbo',
			'gpt-4-turbo-2024-04-09',
			'gpt-4-turbo-preview',
			'gpt-4-0125-preview',
			'gpt-4-1106-preview',
			'gpt-4',
			'gpt-4-0613',
			'gpt-3.5-turbo-0125',
			'gpt-3.5-turbo',
			'gpt-3.5-turbo-1106',
		],
	}),
	ollama: () => ({ // TODO make this do a fetch to get the models
		// model: 'codestral',
		models: [
			'codestral',
			'qwen2.5-coder',
			'qwen2.5-coder:0.5b',
			'qwen2.5-coder:1.5b',
			'qwen2.5-coder:3b',
			'qwen2.5-coder:7b',
			'qwen2.5-coder:14b',
			'qwen2.5-coder:32b',
			'codegemma',
			'codegemma:2b',
			'codegemma:7b',
			'codellama',
			'codellama:7b',
			'codellama:13b',
			'codellama:34b',
			'codellama:70b',
			'codellama:code',
			'codellama:python',
			'command-r',
			'command-r:35b',
			'command-r-plus',
			'command-r-plus:104b',
			'deepseek-coder-v2',
			'deepseek-coder-v2:16b',
			'deepseek-coder-v2:236b',
			'falcon2',
			'falcon2:11b',
			'firefunction-v2',
			'firefunction-v2:70b',
			'gemma',
			'gemma:2b',
			'gemma:7b',
			'gemma2',
			'gemma2:2b',
			'gemma2:9b',
			'gemma2:27b',
			'llama2',
			'llama2:7b',
			'llama2:13b',
			'llama2:70b',
			'llama3',
			'llama3:8b',
			'llama3:70b',
			'llama3-chatqa',
			'llama3-chatqa:8b',
			'llama3-chatqa:70b',
			'llama3-gradient',
			'llama3-gradient:8b',
			'llama3-gradient:70b',
			'llama3.1',
			'llama3.1:8b',
			'llama3.1:70b',
			'llama3.1:405b',
			'llava',
			'llava:7b',
			'llava:13b',
			'llava:34b',
			'llava-llama3',
			'llava-llama3:8b',
			'llava-phi3',
			'llava-phi3:3.8b',
			'mistral',
			'mistral:7b',
			'mistral-large',
			'mistral-large:123b',
			'mistral-nemo',
			'mistral-nemo:12b',
			'mixtral',
			'mixtral:8x7b',
			'mixtral:8x22b',
			'moondream',
			'moondream:1.8b',
			'openhermes',
			'openhermes:v2.5',
			'phi3',
			'phi3:3.8b',
			'phi3:14b',
			'phi3.5',
			'phi3.5:3.8b',
			'qwen',
			'qwen:7b',
			'qwen:14b',
			'qwen:32b',
			'qwen:72b',
			'qwen:110b',
			'qwen2',
			'qwen2:0.5b',
			'qwen2:1.5b',
			'qwen2:7b',
			'qwen2:72b',
			'smollm',
			'smollm:135m',
			'smollm:360m',
			'smollm:1.7b',
		],
	}),
	openRouter: () => ({
		// model: 'openai/gpt-4o',
		models: null, // any
	}),
	openAICompatible: () => ({
		// model: 'openai/gpt-4o',
		models: null, // any
	}),
	gemini: () => ({
		// model: 'gemini-1.5-flash',
		models: [
			'gemini-1.5-flash',
			'gemini-1.5-pro',
			'gemini-1.5-flash-8b',
			'gemini-1.0-pro'
		],
	}),
	groq: () => ({
		// model: 'mixtral-8x7b-32768',
		models: [
			"mixtral-8x7b-32768",
			"llama2-70b-4096",
			"gemma-7b-it"
		]
	})
} as const



export type ProviderName = keyof typeof voidProviderDefaults
export const providerNames = Object.keys(voidProviderDefaults) as ProviderName[]



// state
export type SettingsOfProvider = {
	[providerName in ProviderName]: (
		{
			[optionName in keyof typeof voidProviderDefaults[providerName]]: string
		}
		&
		{
			enabled: string, // 'true' | 'false'
			maxTokens: string,

			models: string[] | null, // if null, user can type in any string as a model
		})
}


type UnionOfKeys<T> = T extends T ? keyof T : never;

export type SettingName = UnionOfKeys<SettingsOfProvider[ProviderName]>



type DisplayInfo = {
	title: string,
	type: string,
	placeholder: string,
}

export const titleOfProviderName = (providerName: ProviderName) => {
	if (providerName === 'anthropic')
		return 'Anthropic'
	else if (providerName === 'openAI')
		return 'OpenAI'
	else if (providerName === 'ollama')
		return 'Ollama'
	else if (providerName === 'openRouter')
		return 'OpenRouter'
	else if (providerName === 'openAICompatible')
		return 'OpenAI-Compatible'
	else if (providerName === 'gemini')
		return 'Gemini'
	else if (providerName === 'groq')
		return 'Groq'

	throw new Error(`descOfProviderName: Unknown provider name: "${providerName}"`)
}

export const displayInfoOfSettingName = (providerName: ProviderName, settingName: SettingName): DisplayInfo => {
	if (settingName === 'apiKey') {
		return {
			title: 'API Key',
			type: 'string',
			placeholder: providerName === 'anthropic' ? 'sk-ant-key...' : // sk-ant-api03-key
				providerName === 'openAI' ? 'sk-proj-key...' :
					providerName === 'openRouter' ? 'sk-or-key...' : // sk-or-v1-key
						providerName === 'gemini' ? 'key...' :
							providerName === 'groq' ? 'gsk_key...' :
								providerName === 'openAICompatible' ? 'sk-key...' :
									'(never)',
		}
	}
	else if (settingName === 'endpoint') {
		return {
			title: providerName === 'ollama' ? 'Your Ollama endpoint' :
				providerName === 'openAICompatible' ? 'baseURL' // (do not include /chat/completions)
					: '(never)',
			type: 'string',
			placeholder: providerName === 'ollama' ? voidProviderDefaults.ollama.endpoint
				: providerName === 'openAICompatible' ? 'https://my-website.com/v1'
					: '(never)',
		}
	}
	else if (settingName === 'maxTokens') {
		return {
			title: 'Max Tokens',
			type: 'number',
			placeholder: '1024',
		}
	}
	else if (settingName === 'enabled') {
		return {
			title: 'Enabled?',
			type: 'boolean',
			placeholder: '(never)',
		}
	}
	else if (settingName === 'models') {
		return {
			title: 'Available Models',
			type: '(never)',
			placeholder: '(never)',
		}
	}

	throw new Error(`displayInfo: Unknown setting name: "${settingName}"`)

}



export const defaultVoidProviderState: SettingsOfProvider = {
	anthropic: {
		...voidProviderDefaults.anthropic,
		...voidInitModelOptions.anthropic(),
		enabled: 'false',
		maxTokens: '',
	},
	openAI: {
		...voidProviderDefaults.openAI,
		...voidInitModelOptions.openAI(),
		enabled: 'false',
		maxTokens: '',
	},
	ollama: {
		...voidProviderDefaults.ollama,
		...voidInitModelOptions.ollama(),
		enabled: 'false',
		maxTokens: '',
	},
	openRouter: {
		...voidProviderDefaults.openRouter,
		...voidInitModelOptions.openRouter(),
		enabled: 'false',
		maxTokens: '',
	},
	openAICompatible: {
		...voidProviderDefaults.openAICompatible,
		...voidInitModelOptions.openAICompatible(),
		enabled: 'false',
		maxTokens: '',
	},
	gemini: {
		...voidProviderDefaults.gemini,
		...voidInitModelOptions.gemini(),
		enabled: 'false',
		maxTokens: '',
	},
	groq: {
		...voidProviderDefaults.groq,
		...voidInitModelOptions.groq(),
		enabled: 'false',
		maxTokens: '',
	}
}



// this is a state
export type ModelSelectionOfFeature = {
	'Ctrl+L': {
		providerName: ProviderName,
		modelName: string,
	} | null,
	'Ctrl+K': {
		providerName: ProviderName,
		modelName: string,
	} | null,
	'Autocomplete': {
		providerName: ProviderName,
		modelName: string,
	} | null,
}
export type FeatureName = keyof ModelSelectionOfFeature
export const featureNames = ['Ctrl+L', 'Ctrl+K', 'Autocomplete'] as const

