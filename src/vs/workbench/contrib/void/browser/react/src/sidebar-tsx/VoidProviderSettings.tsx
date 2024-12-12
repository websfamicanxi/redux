/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import React, { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { titleOfProviderName, displayInfoOfSettingName, ProviderName, providerNames, featureNames } from '../../../../../../../platform/void/common/voidConfigTypes.js'
import { VoidInputBox } from './inputs.js'
import { useConfigState, useService } from '../util/services.js'
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js'
import ErrorBoundary from './ErrorBoundary.js'


const Setting = ({ providerName, settingName }: { providerName: ProviderName, settingName: any }) => {

	const { title, type, placeholder } = displayInfoOfSettingName(providerName, settingName)
	const voidConfigService = useService('configStateService')


	return <><ErrorBoundary>
		<label>{title}</label>
		<VoidInputBox
			placeholder={placeholder}
			onChangeText={useCallback((newVal) => {
				voidConfigService.setSettingOfProvider(providerName, settingName, newVal)
				// if we just disabeld this provider, we should unselect all models that use it
				if (settingName === 'enabled' && newVal !== 'true') {
					for (let featureName of featureNames) {
						if (voidConfigService.state.modelSelectionOfFeature[featureName]?.providerName === providerName)
							voidConfigService.setModelSelectionOfFeature(featureName, null)
					}
				}
			}, [voidConfigService, providerName, settingName])}

			// we are responsible for setting the initial value here
			onCreateInstance={useCallback((instance: InputBox) => {
				const updateInstance = () => {
					const settingsAtProvider = voidConfigService.state.settingsOfProvider[providerName];
					// @ts-ignore
					const stateVal = settingsAtProvider[settingName]
					instance.value = stateVal
				}
				updateInstance()
				const disposable = voidConfigService.onDidGetInitState(updateInstance)
				return [disposable]
			}, [voidConfigService, providerName, settingName])}
			multiline={false}
		/>
	</ErrorBoundary></>

}


const SettingsForProvider = ({ providerName }: { providerName: ProviderName }) => {
	const voidConfigState = useConfigState()
	const { models, ...others } = voidConfigState[providerName]
	return <>
		<h1 className='text-xl'>{titleOfProviderName(providerName)}</h1>
		{/* settings besides models (e.g. api key) */}
		{Object.keys(others).map((settingName, i) => {
			return <Setting key={settingName} providerName={providerName} settingName={settingName} />
		})}
	</>
}


export const VoidProviderSettings = () => {

	return <>
		{providerNames.map(providerName =>
			<SettingsForProvider key={providerName} providerName={providerName} />
		)}


	</>
}
