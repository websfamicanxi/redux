/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IVoidSettingsService } from './voidSettingsService.js';
import { ILLMMessageService } from './llmMessageService.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../base/common/lifecycle.js';
import { RefreshableProviderName, refreshableProviderNames, SettingsOfProvider } from './voidSettingsTypes.js';
import { OllamaModelResponse, OpenaiCompatibleModelResponse } from './llmMessageTypes.js';




type RefreshableState = ({
	state: 'init',
	timeoutId: null,
} | {
	state: 'refreshing',
	timeoutId: NodeJS.Timeout | null, // the timeoutId of the most recent call to refreshModels
} | {
	state: 'success',
	timeoutId: null,
})


export type RefreshModelStateOfProvider = Record<RefreshableProviderName, RefreshableState>



const refreshBasedOn: { [k in RefreshableProviderName]: (keyof SettingsOfProvider[k])[] } = {
	ollama: ['enabled', 'endpoint'],
	openAICompatible: ['enabled', 'endpoint', 'apiKey'],
}
const REFRESH_INTERVAL = 5_000
// const COOLDOWN_TIMEOUT = 300

// element-wise equals
function eq<T>(a: T[], b: T[]): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false
	}
	return true
}
export interface IRefreshModelService {
	readonly _serviceBrand: undefined;
	refreshModels: (providerName: RefreshableProviderName) => Promise<void>;
	onDidChangeState: Event<RefreshableProviderName>;
	state: RefreshModelStateOfProvider;
}

export const IRefreshModelService = createDecorator<IRefreshModelService>('RefreshModelService');

export class RefreshModelService extends Disposable implements IRefreshModelService {

	readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = new Emitter<RefreshableProviderName>();
	readonly onDidChangeState: Event<RefreshableProviderName> = this._onDidChangeState.event; // this is primarily for use in react, so react can listen + update on state changes

	private readonly _onDidAutoEnable = new Emitter<RefreshableProviderName>();

	constructor(
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
	) {
		super()


		const disposables: Set<IDisposable> = new Set()

		const initializePollingAndOnChange = () => {
			this._clearAllTimeouts()
			disposables.forEach(d => d.dispose())
			disposables.clear()

			if (!voidSettingsService.state.featureFlagSettings.autoRefreshModels) return

			for (const providerName of refreshableProviderNames) {

				const { enabled } = this.voidSettingsService.state.settingsOfProvider[providerName]
				this.refreshModels(providerName, !enabled)

				// every time providerName.enabled changes, refresh models too, like a useEffect
				let relevantVals = () => refreshBasedOn[providerName].map(settingName => this.voidSettingsService.state.settingsOfProvider[providerName][settingName])
				let prevVals = relevantVals() // each iteration of a for loop has its own context and vars, so this is ok
				disposables.add(
					this.voidSettingsService.onDidChangeState(() => { // we might want to debounce this
						const newVals = relevantVals()
						if (!eq(prevVals, newVals)) {

							const prevEnabled = prevVals[0] as boolean
							const enabled = newVals[0] as boolean

							// if it was just enabled, or there was a change and it wasn't to the enabled state, refresh
							if ((enabled && !prevEnabled) || (!enabled && !prevEnabled)) {
								// if user just clicked enable, refresh
								this.refreshModels(providerName, !enabled)
							}
							else {
								// else if user just clicked disable, don't refresh

								// //give cooldown before re-enabling (or at least re-fetching)
								// const timeoutId = setTimeout(() => this.refreshModels(providerName, !enabled), COOLDOWN_TIMEOUT)
								// this._setTimeoutId(providerName, timeoutId)
							}
							prevVals = newVals
						}
					})
				)
			}
		}

		// on mount (when get init settings state), and if a relevant feature flag changes (detected natively right now by refreshing if any flag changes), start refreshing models
		voidSettingsService.waitForInitState.then(() => {
			initializePollingAndOnChange()
			this._register(
				voidSettingsService.onDidChangeState((type) => { if (type === 'featureFlagSettings') initializePollingAndOnChange() })
			)
		})

	}

	state: RefreshModelStateOfProvider = {
		ollama: { state: 'init', timeoutId: null },
		openAICompatible: { state: 'init', timeoutId: null },
	}


	// start listening for models (and don't stop until success)
	async refreshModels(providerName: RefreshableProviderName, enableProviderOnSuccess?: boolean) {
		this._clearProviderTimeout(providerName)

		// start loading models
		this._setRefreshState(providerName, 'refreshing')

		const fn = providerName === 'ollama' ? this.llmMessageService.ollamaList
			: providerName === 'openAICompatible' ? this.llmMessageService.openAICompatibleList
				: () => { }

		fn({
			onSuccess: ({ models }) => {
				this.voidSettingsService.setDefaultModels(providerName, models.map(model => {
					if (providerName === 'ollama') return (model as OllamaModelResponse).name
					else if (providerName === 'openAICompatible') return (model as OpenaiCompatibleModelResponse).id
					else throw new Error('refreshMode fn: unknown provider', providerName)
				}))

				if (enableProviderOnSuccess) {
					this.voidSettingsService.setSettingOfProvider(providerName, 'enabled', true)
					this._onDidAutoEnable.fire(providerName)
				}

				this._setRefreshState(providerName, 'success')
			},
			onError: ({ error }) => {
				// poll
				console.log('retrying list models:', providerName, error)
				const timeoutId = setTimeout(() => this.refreshModels(providerName, enableProviderOnSuccess), REFRESH_INTERVAL)
				this._setTimeoutId(providerName, timeoutId)
			}
		})
	}

	_clearAllTimeouts() {
		for (const providerName of refreshableProviderNames) {
			this._clearProviderTimeout(providerName)
		}
	}

	_clearProviderTimeout(providerName: RefreshableProviderName) {
		// cancel any existing poll
		if (this.state[providerName].timeoutId) {
			clearTimeout(this.state[providerName].timeoutId)
			this._setTimeoutId(providerName, null)
		}
	}

	private _setTimeoutId(providerName: RefreshableProviderName, timeoutId: NodeJS.Timeout | null) {
		this.state[providerName].timeoutId = timeoutId
	}

	private _setRefreshState(providerName: RefreshableProviderName, state: RefreshableState['state']) {
		this.state[providerName].state = state
		this._onDidChangeState.fire(providerName)
	}
}

registerSingleton(IRefreshModelService, RefreshModelService, InstantiationType.Eager);

