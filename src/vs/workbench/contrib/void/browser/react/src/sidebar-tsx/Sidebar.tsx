/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/
import React, { useEffect, useState } from 'react'
import { mountFnGenerator } from '../util/mountFnGenerator.js'

// import { SidebarSettings } from './SidebarSettings.js';


import { useSidebarState } from '../util/services.js';
// import { SidebarThreadSelector } from './SidebarThreadSelector.js';
// import { SidebarChat } from './SidebarChat.js';

import '../styles.css'
import { SidebarThreadSelector } from './SidebarThreadSelector.js';
import { SidebarChat } from './SidebarChat.js';
import { SidebarModelSettings } from './SidebarModelSettings.js';
import { SidebarProviderSettings } from './SidebarProviderSettings.js';
import ErrorBoundary from './ErrorBoundary.js';

const Sidebar = () => {
	const sidebarState = useSidebarState()
	const { isHistoryOpen, currentTab: tab } = sidebarState

	// className='@@void-scope'
	return <div className='@@void-scope'>
		<div className={`flex flex-col w-full px-2 py-2`}>

			{/* <span onClick={() => {
				const tabs = ['chat', 'settings', 'threadSelector']
				const index = tabs.indexOf(tab)
				sidebarStateService.setState({ currentTab: tabs[(index + 1) % tabs.length] as any })
			}}>clickme {tab}</span> */}

			<div className={`mb-2 ${isHistoryOpen ? '' : 'hidden'}`}>
				<ErrorBoundary>
					<SidebarThreadSelector />
				</ErrorBoundary>
			</div>

			<div className={`${tab === 'chat' ? '' : 'hidden'}`}>
				<ErrorBoundary>
					<SidebarChat />
				</ErrorBoundary>
			</div>

			<div className={`${tab === 'settings' ? '' : 'hidden'}`}>
				<ErrorBoundary>
					<SidebarModelSettings />
				</ErrorBoundary>
				--------
				<ErrorBoundary>
					<SidebarProviderSettings />
				</ErrorBoundary>
			</div>

		</div>
	</div>


}


const mountFn = mountFnGenerator(Sidebar)
export default mountFn

