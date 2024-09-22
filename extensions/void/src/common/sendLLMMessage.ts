import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// import ollama from 'ollama'

export type ApiConfig = {
	anthropic: {
		apikey: string,
		model: string,
		maxTokens: string
	},
	openai: {
		apikey: string
	},
	greptile: {
		apikey: string,
		githubPAT: string,
		repoinfo: {
			remote: string, // e.g. 'github'
			repository: string, // e.g. 'voideditor/void'
			branch: string // e.g. 'main'
		}
	},
	ollama: {
		// TODO
	},
	whichApi: string
}



type OnText = (newText: string, fullText: string) => void

export type LLMMessage = {
	role: 'user' | 'assistant',
	content: string
}

type SendLLMMessageFnTypeInternal = (params: {
	messages: LLMMessage[],
	onText: OnText,
	onFinalMessage: (input: string) => void,
	apiConfig: ApiConfig,
})
	=> {
		abort: () => void
	}

type SendLLMMessageFnTypeExternal = (params: {
	messages: LLMMessage[],
	onText: OnText,
	onFinalMessage: (input: string) => void,
	apiConfig: ApiConfig | null,
})
	=> {
		abort: () => void
	}




// Claude
const sendClaudeMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, apiConfig }) => {

	const anthropic = new Anthropic({ apiKey: apiConfig.anthropic.apikey, dangerouslyAllowBrowser: true }); // defaults to process.env["ANTHROPIC_API_KEY"]

	const stream = anthropic.messages.stream({
		model: apiConfig.anthropic.model,
		max_tokens: parseInt(apiConfig.anthropic.maxTokens),
		messages: messages,
	});

	let did_abort = false

	// when receive text
	stream.on('text', (newText, fullText) => {
		if (did_abort) return
		onText(newText, fullText)
	})

	// when we get the final message on this stream (or when error/fail)
	stream.on('finalMessage', (claude_response) => {
		if (did_abort) return
		// stringify the response's content
		let content = claude_response.content.map(c => { if (c.type === 'text') { return c.text } }).join('\n');
		onFinalMessage(content)
	})


	// if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
	const abort = () => {
		// stream.abort() // this doesnt appear to do anything, but it should try to stop claude from generating anymore
		did_abort = true
	}

	return { abort }

};




// OpenAI
const sendOpenAIMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, apiConfig }) => {

	let did_abort = false
	let fullText = ''

	// if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
	let abort: () => void = () => { did_abort = true }

	const openai = new OpenAI({ apiKey: apiConfig.openai.apikey, dangerouslyAllowBrowser: true });

	openai.chat.completions.create({
		model: 'gpt-4o-2024-08-06',
		messages: messages,
		stream: true,
	})
		.then(async response => {
			abort = () => {
				// response.controller.abort() // this isn't needed now, to keep consistency with claude will leave it commented
				did_abort = true;
			}
			// when receive text
			try {
				for await (const chunk of response) {
					if (did_abort) return;
					const newText = chunk.choices[0]?.delta?.content || '';
					fullText += newText;
					onText(newText, fullText);
				}
				onFinalMessage(fullText);
			}
			// when error/fail
			catch (error) {
				console.error('Error in OpenAI stream:', error);
				onFinalMessage(fullText);
			}
			// when we get the final message on this stream
			onFinalMessage(fullText)
		})
	return { abort };
};



// Greptile
// https://docs.greptile.com/api-reference/query
// https://docs.greptile.com/quickstart#sample-response-streamed

const sendGreptileMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, apiConfig }) => {

	let did_abort = false
	let fullText = ''

	// if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
	let abort: () => void = () => { did_abort = true }


	fetch('https://api.greptile.com/v2/query', {
		method: 'POST',
		headers: {
			"Authorization": `Bearer ${apiConfig.greptile.apikey}`,
			"X-Github-Token": `${apiConfig.greptile.githubPAT}`,
			"Content-Type": `application/json`,
		},
		body: JSON.stringify({
			messages,
			stream: true,
			repositories: [apiConfig.greptile.repoinfo]
		}),
	})
		// this is {message}\n{message}\n{message}...\n
		.then(async response => {
			const text = await response.text()
			console.log('got greptile', text)
			return JSON.parse(`[${text.trim().split('\n').join(',')}]`)
		})
		// TODO make this actually stream, right now it just sends one message at the end
		.then(async responseArr => {
			if (did_abort)
				return

			for (let response of responseArr) {

				const type: string = response['type']
				const message = response['message']

				// when receive text
				if (type === 'message') {
					fullText += message
					onText(message, fullText)
				}
				else if (type === 'sources') {
					const { filepath, linestart, lineend } = message as { filepath: string, linestart: number | null, lineend: number | null }
					fullText += filepath
					onText(filepath, fullText)
				}
				// type: 'status' with an empty 'message' means last message
				else if (type === 'status') {
					if (!message) {
						onFinalMessage(fullText)
					}
				}
			}

		})
		.catch(e => {
			console.error('Error in Greptile stream:', e);
			onFinalMessage(fullText);

		});

	return { abort }



}


export const sendLLMMessage: SendLLMMessageFnTypeExternal = ({ messages, onText, onFinalMessage, apiConfig }) => {
	if (!apiConfig) return { abort: () => { } }

	const whichApi = apiConfig.whichApi

	if (whichApi === 'anthropic') {
		return sendClaudeMsg({ messages, onText, onFinalMessage, apiConfig })
	}
	else if (whichApi === 'openai') {
		return sendOpenAIMsg({ messages, onText, onFinalMessage, apiConfig })
	}
	else if (whichApi === 'greptile') {
		return sendGreptileMsg({ messages, onText, onFinalMessage, apiConfig })
	}
	else if (whichApi === 'ollama') {
		return sendClaudeMsg({ messages, onText, onFinalMessage, apiConfig }) // TODO
	}
	else {
		console.error(`Error: whichApi was ${whichApi}, which is not recognized!`)
		return sendClaudeMsg({ messages, onText, onFinalMessage, apiConfig }) // TODO
	}

}


// Ollama
// const sendOllamaMsg: sendMsgFnType = ({ messages, onText, onFinalMessage }) => {

//     let did_abort = false
//     let fullText = ''

//     // if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
//     let abort: () => void = () => {
//         did_abort = true
//     }

//     ollama.chat({ model: 'llama3.1', messages: messages, stream: true })
//         .then(async response => {

//             abort = () => {
//                 // response.abort() // this isn't needed now, to keep consistency with claude will leave it commented for now
//                 did_abort = true;
//             }

//             // when receive text
//             try {
//                 for await (const part of response) {
//                     if (did_abort) return
//                     let newText = part.message.content
//                     fullText += newText
//                     onText(newText, fullText)
//                 }
//             }
//             // when error/fail
//             catch (e) {
//                 onFinalMessage(fullText)
//                 return
//             }

//             // when we get the final message on this stream
//             onFinalMessage(fullText)
//         })

//     return { abort };
// };

