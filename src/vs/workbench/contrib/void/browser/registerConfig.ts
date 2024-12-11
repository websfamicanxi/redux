/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { deepClone } from '../../../../base/common/objects.js';
import { IEncryptionService } from '../../../../platform/encryption/common/encryptionService.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { defaultVoidProviderState, FeatureName, ProviderName, ModelSelectionOfFeature, SettingsOfProvider } from '../../../../platform/void/common/configTypes.js';



const CONFIG_STORAGE_KEY = 'void.voidConfigStateII'

type SetSettingOfProviderFn = <K extends ProviderName>(
	providerName: K,
	option: keyof SettingsOfProvider[K],
	newVal: string
) => Promise<void>;

type SetModelSelectionOfFeature = <K extends FeatureName>(
	featureName: K,
	newVal: ModelSelectionOfFeature[K],
) => Promise<void>;


type VoidConfigState = {
	settingsOfProvider: SettingsOfProvider; // optionsOfProvider
	modelSelectionOfFeature: ModelSelectionOfFeature; // stateOfFeature
}

export interface IVoidConfigStateService {
	readonly _serviceBrand: undefined;
	readonly state: VoidConfigState;
	onDidChangeState: Event<void>;
	setSettingOfProvider: SetSettingOfProviderFn;
	setModelSelectionOfFeature: SetModelSelectionOfFeature;
}


const defaultState = () => {
	const d: VoidConfigState = {
		settingsOfProvider: deepClone(defaultVoidProviderState),
		modelSelectionOfFeature: { 'Ctrl+L': null, 'Ctrl+K': null, 'Autocomplete': null }
	}
	return d
}


export const IVoidConfigStateService = createDecorator<IVoidConfigStateService>('VoidConfigStateService');
class VoidConfigStateService extends Disposable implements IVoidConfigStateService {
	_serviceBrand: undefined;

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event; // this is primarily for use in react, so react can listen + update on state changes

	state: VoidConfigState;

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IEncryptionService private readonly _encryptionService: IEncryptionService,
		// could have used this, but it's clearer the way it is (+ slightly different eg StorageTarget.USER)
		// @ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
	) {
		super()

		// at the start, we haven't read the partial config yet, but we need to set state to something
		this.state = defaultState()

		// read and update the actual state immediately
		this._readVoidConfigState().then(voidConfigState => { this._setState(voidConfigState) })

	}

	private async _readVoidConfigState(): Promise<VoidConfigState> {
		const encryptedPartialConfig = this._storageService.get(CONFIG_STORAGE_KEY, StorageScope.APPLICATION)

		if (!encryptedPartialConfig)
			return defaultState()

		const voidConfigStateStr = await this._encryptionService.decrypt(encryptedPartialConfig)
		return JSON.parse(voidConfigStateStr)
	}


	private async _storeVoidConfigState(voidConfigState: VoidConfigState) {
		const encryptedVoidConfigStr = await this._encryptionService.encrypt(JSON.stringify(voidConfigState))
		this._storageService.store(CONFIG_STORAGE_KEY, encryptedVoidConfigStr, StorageScope.APPLICATION, StorageTarget.USER)
	}

	setSettingOfProvider: SetSettingOfProviderFn = async (providerName, option, newVal) => {
		const newState: VoidConfigState = {
			...this.state,
			settingsOfProvider: {
				...this.state.settingsOfProvider,
				[providerName]: {
					...this.state.settingsOfProvider[providerName],
					[option]: newVal,
				}
			}
		}
		console.log('NEW STATE I', newState)

		await this._storeVoidConfigState(newState)
		this._setState(newState)
	}

	setModelSelectionOfFeature: SetModelSelectionOfFeature = async (featureName, newVal) => {
		const newState: VoidConfigState = {
			...this.state,
			modelSelectionOfFeature: {
				...this.state.modelSelectionOfFeature,
				[featureName]: newVal
			}
		}
		console.log('NEW STATE II', newState)

		await this._storeVoidConfigState(newState)
		this._setState(newState)
	}



	// internal function to update state, should be called every time state changes
	private async _setState(voidConfigState: VoidConfigState) {
		this.state = voidConfigState
		this._onDidChangeState.fire()
	}

}

registerSingleton(IVoidConfigStateService, VoidConfigStateService, InstantiationType.Eager);
