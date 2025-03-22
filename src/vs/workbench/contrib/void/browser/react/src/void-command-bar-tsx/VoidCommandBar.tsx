/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


import { useAccessor, useCommandBarState, useIsDark } from '../util/services.js';

import '../styles.css'
import { useCallback, useEffect, useState, useRef } from 'react';
import { ScrollType } from '../../../../../../../editor/common/editorCommon.js';
import { acceptAllBg, acceptBorder, buttonFontSize, buttonTextColor, rejectAllBg, rejectBorder } from '../../../../common/helpers/colors.js';
import { VoidCommandBarProps } from '../../../voidCommandBarService.js';

export const VoidCommandBarMain = ({ uri, editor }: VoidCommandBarProps) => {
	const isDark = useIsDark()

	if (uri?.scheme !== 'file') return null // don't show in editors that we made, they must be files

	return <div
		className={`@@void-scope ${isDark ? 'dark' : ''}`}
	>
		<VoidCommandBar uri={uri} editor={editor} />
	</div>
}




const stepIdx = (currIdx: number | null, len: number, step: -1 | 1) => {
	if (len === 0) return null
	return ((currIdx ?? 0) + step + len) % len // for some reason, small negatives are kept negative. just add len to offset
}



const VoidCommandBar = ({ uri, editor }: VoidCommandBarProps) => {
	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const editorService = accessor.get('ICodeEditorService')
	const metricsService = accessor.get('IMetricsService')
	const commandService = accessor.get('ICommandService')
	const commandBarService = accessor.get('IVoidCommandBarService')
	const voidModelService = accessor.get('IVoidModelService')
	const { state: commandBarState, sortedURIs: sortedCommandBarURIs } = useCommandBarState()


	// latestUriIdx is used to remember place in leftRight
	const _latestValidUriIdxRef = useRef<number | null>(null)

	// i is the current index of the URI in sortedCommandBarURIs
	const i_ = sortedCommandBarURIs.findIndex(e => e.fsPath === uri?.fsPath)
	const currFileIdx = i_ === -1 ? null : i_
	useEffect(() => {
		if (currFileIdx !== null) _latestValidUriIdxRef.current = currFileIdx
	}, [currFileIdx])

	const uriIdxInStepper = currFileIdx !== null ? currFileIdx // use currFileIdx if it exists, else use latestNotNullUriIdxRef
		: _latestValidUriIdxRef.current === null ? null
			: _latestValidUriIdxRef.current < sortedCommandBarURIs.length ? _latestValidUriIdxRef.current
				: null



	const getNextDiffIdx = (step: 1 | -1) => {
		// check undefined
		if (!uri) return null
		const s = commandBarState[uri.fsPath]
		if (!s) return null
		const { diffIdx, sortedDiffIds } = s
		// get next idx
		const nextDiffIdx = stepIdx(diffIdx, sortedDiffIds.length, step)
		return nextDiffIdx
	}
	const goToDiffIdx = (idx: number | null) => {
		// check undefined
		if (!uri) return
		const s = commandBarState[uri.fsPath]
		if (!s) return
		const { sortedDiffIds } = s
		// reveal
		if (idx !== null) {
			const diffid = sortedDiffIds[idx]
			const diff = editCodeService.diffOfId[diffid]
			const range = { startLineNumber: diff.startLine, endLineNumber: diff.startLine, startColumn: 1, endColumn: 1 };
			editor.revealRangeInCenter(range, ScrollType.Immediate)
			commandBarService.setDiffIdx(uri, idx)
		}
	}
	const getNextUriIdx = (step: 1 | -1) => {
		return stepIdx(uriIdxInStepper, sortedCommandBarURIs.length, step)
	}
	const goToURIIdx = async (idx: number | null) => {
		if (idx === null) return
		const nextURI = sortedCommandBarURIs[idx]
		editCodeService.diffAreasOfURI
		const { model } = await voidModelService.getModelSafe(nextURI)
		if (model) {
			// switch to the URI
			editorService.openCodeEditor({ resource: nextURI, options: { revealIfVisible: true } }, editor)
		}
	}



	// when change URI, scroll to the proper spot
	useEffect(() => {
		setTimeout(() => {
			// check undefined
			if (!uri) return
			const s = commandBarService.stateOfURI[uri.fsPath]
			if (!s) return
			const { diffIdx } = s
			goToDiffIdx(diffIdx)
		}, 50)
	}, [uri, commandBarService])


	const currDiffIdx = uri ? commandBarState[uri.fsPath]?.diffIdx ?? null : null
	const sortedDiffIds = uri ? commandBarState[uri.fsPath]?.sortedDiffIds ?? [] : []
	const sortedDiffZoneIds = uri ? commandBarState[uri.fsPath]?.sortedDiffZoneIds ?? [] : []


	const isAChangeInThisFile = sortedDiffIds.length !== 0
	const isADiffZoneInThisFile = sortedDiffZoneIds.length !== 0
	const isADiffZoneInAnyFile = sortedCommandBarURIs.length !== 0

	const streamState = uri ? commandBarService.getStreamState(uri) : null
	const showAcceptRejectAll = streamState === 'idle-has-changes'

	const nextDiffIdx = getNextDiffIdx(1)
	const prevDiffIdx = getNextDiffIdx(-1)
	const nextURIIdx = getNextUriIdx(1)
	const prevURIIdx = getNextUriIdx(-1)

	const upDownDisabled = prevDiffIdx === null || nextDiffIdx === null
	const leftRightDisabled = prevURIIdx === null || nextURIIdx === null

	const upButton = <button
		className={`
			size-6 rounded cursor-pointer
			hover:bg-void-bg-1-alt
			--border border-void-border-3 focus:border-void-border-1
		`}
		disabled={upDownDisabled}
		onClick={() => { goToDiffIdx(prevDiffIdx) }}
		onKeyDown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				goToDiffIdx(prevDiffIdx);
			}
		}}
	>↑</button>

	const downButton = <button
		className={`
			size-6 rounded cursor-pointer
			hover:bg-void-bg-1-alt
			--border border-void-border-3 focus:border-void-border-1
		`}
		disabled={upDownDisabled}
		onClick={() => { goToDiffIdx(nextDiffIdx) }}
		onKeyDown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				goToDiffIdx(nextDiffIdx);
			}
		}}
	>↓</button>

	const leftButton = <button
		className={`
			size-6 rounded cursor-pointer
			hover:bg-void-bg-1-alt
			--border border-void-border-3 focus:border-void-border-1
		`}
		disabled={leftRightDisabled}
		onClick={() => goToURIIdx(prevURIIdx)}
		onKeyDown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				goToURIIdx(prevURIIdx);
			}
		}}
	>←</button>

	const rightButton = <button
		className={`
			size-6 rounded cursor-pointer
			hover:bg-void-bg-1-alt
			--border border-void-border-3 focus:border-void-border-1
		`}
		disabled={leftRightDisabled}
		onClick={() => goToURIIdx(nextURIIdx)}
		onKeyDown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				goToURIIdx(nextURIIdx);
			}
		}}
	>→</button>



	// accept/reject if current URI has changes
	const onAcceptAll = () => {
		if (!uri) return
		editCodeService.acceptOrRejectAllDiffAreas({ uri, behavior: 'accept', removeCtrlKs: false, _addToHistory: true })
		metricsService.capture('Accept All', {})
	}
	const onRejectAll = () => {
		if (!uri) return
		editCodeService.acceptOrRejectAllDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false, _addToHistory: true })
		metricsService.capture('Reject All', {})
	}


	if (!isADiffZoneInAnyFile) return null

	const acceptAllButton = <button
		className='pointer-events-auto text-nowrap'
		onClick={onAcceptAll}
		style={{
			backgroundColor: acceptAllBg,
			border: acceptBorder,
			color: buttonTextColor,
			fontSize: buttonFontSize,
			padding: '2px 4px',
			borderRadius: '6px',
			cursor: 'pointer'
		}}
	>
		Accept File
	</button>


	const rejectAllButton = <button
		className='pointer-events-auto text-nowrap'
		onClick={onRejectAll}
		style={{
			backgroundColor: rejectAllBg,
			border: rejectBorder,
			color: 'white',
			fontSize: buttonFontSize,
			padding: '2px 4px',
			borderRadius: '6px',
			cursor: 'pointer'
		}}
	>
		Reject File
	</button>

	const acceptRejectAllButtons = <div className="flex items-center gap-1 text-sm">
		{acceptAllButton}
		{rejectAllButton}
	</div>

	// const closeCommandBar = useCallback(() => {
	// 	commandService.executeCommand('void.hideCommandBar');
	// }, [commandService]);

	// const hideButton = <button
	// 	className='ml-auto pointer-events-auto'
	// 	onClick={closeCommandBar}
	// 	style={{
	// 		color: buttonTextColor,
	// 		fontSize: buttonFontSize,
	// 		padding: '2px 4px',
	// 		borderRadius: '6px',
	// 		cursor: 'pointer'
	// 	}}
	// 	title="Close command bar"
	// >x
	// </button>

	const leftRightUpDownButtons = <div className='p-1 gap-1 flex flex-col items-start bg-void-bg-2 rounded shadow-md border border-void-border-2'>
		<div className="flex flex-col gap-1">
			{/* Changes in file */}
			{isADiffZoneInThisFile &&
				<div className={`flex items-center ${upDownDisabled ? 'opacity-50' : ''}`}>
					{downButton}
					{upButton}
					<div className="text-xs mx-1 w-fit">
						{isAChangeInThisFile ?
							`Diff ${(currDiffIdx ?? 0) + 1} of ${sortedDiffIds.length}`
							: `No changes`
						}
					</div>
				</div>
			}

			{/* Files */}
			{isADiffZoneInAnyFile &&
				<div className={`flex items-center ${leftRightDisabled ? 'opacity-50' : ''}`}>
					{leftButton}
					{/* <div className="w-px h-3 bg-void-border-3 mx-0.5 shadow-sm"></div> */}
					{rightButton}
					{/* <div className="w-px h-3 bg-void-border-3 mx-0.5 shadow-sm"></div> */}
					<div className="text-xs mx-1 w-fit">
						{currFileIdx !== null ?
							`File ${currFileIdx + 1} of ${sortedCommandBarURIs.length}`
							: `${sortedCommandBarURIs.length} file${sortedCommandBarURIs.length === 1 ? '' : 's'} changed`
						}
					</div>
				</div>
			}
		</div>
	</div>

	return <div className={`flex flex-col gap-y-2 mx-2 pointer-events-auto`}>
		{showAcceptRejectAll && acceptRejectAllButtons}
		{leftRightUpDownButtons}

	</div>
}
