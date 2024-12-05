/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/
import React from "react";
import { useService, useThreadsState } from '../util/services.js';


const truncate = (s: string) => {
	let len = s.length
	const TRUNC_AFTER = 16
	if (len >= TRUNC_AFTER)
		s = s.substring(0, TRUNC_AFTER) + '...'
	return s
}


export const SidebarThreadSelector = () => {
	const threadsState = useThreadsState()
	const threadsStateService = useService('threadsStateService')
	const sidebarStateService = useService('sidebarStateService')

	const { allThreads } = threadsState

	// sorted by most recent to least recent
	const sortedThreadIds = Object.keys(allThreads ?? {}).sort((threadId1, threadId2) => allThreads![threadId1].lastModified > allThreads![threadId2].lastModified ? -1 : 1)

	return (
		<div className="flex flex-col gap-y-1 overflow-y-auto h-[30vh]">

			{/* X button at top right */}
			<div className="text-right">
				<button className="btn btn-sm" onClick={() => sidebarStateService.setState({ isHistoryOpen: false })}>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						className="size-4"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M6 18 18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>

			{/* a list of all the past threads */}
			<div className='flex flex-col gap-y-1 max-h-80 overflow-y-auto'>
				{sortedThreadIds.map((threadId) => {
					if (!allThreads)
						return <>Error: Threads not found.</>
					const pastThread = allThreads[threadId]

					let btnStringArr: string[] = []

					let msg1 = truncate(allThreads[threadId].messages[0]?.displayContent ?? '(empty)')
					btnStringArr.push(msg1)

					let msg2 = truncate(allThreads[threadId].messages[1]?.displayContent ?? '')
					if (msg2)
						btnStringArr.push(msg2)

					btnStringArr.push(allThreads[threadId].messages.length + '')

					const btnString = btnStringArr.join(' / ')

					return (
						<button
							key={pastThread.id}
							className={`btn btn-sm rounded-sm ${pastThread.id === threadsStateService.getCurrentThread(threadsState)?.id ? "btn-primary" : "btn-secondary"}`}
							onClick={() => threadsStateService.switchToThread(pastThread.id)}
							title={new Date(pastThread.createdAt).toLocaleString()}
						>
							{btnString}
						</button>
					)
				})}
			</div>

		</div>
	)
}
