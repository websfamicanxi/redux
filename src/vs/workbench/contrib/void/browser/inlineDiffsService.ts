/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor, IOverlayWidget, IViewZone } from '../../../../editor/browser/editorBrowser.js';

// import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
// import { throttle } from '../../../../base/common/decorators.js';
import { ComputedDiff, findDiffs } from './helpers/findDiffs.js';
import { EndOfLinePreference, IModelDecorationOptions, ITextModel } from '../../../../editor/common/model.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { registerColor } from '../../../../platform/theme/common/colorUtils.js';
import { Color, RGBA } from '../../../../base/common/color.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IUndoRedoElement, IUndoRedoService, UndoRedoElementType } from '../../../../platform/undoRedo/common/undoRedo.js';
import { LineSource, renderLines, RenderOptions } from '../../../../editor/browser/widget/diffEditor/components/diffEditorViewZones/renderLines.js';
import { LineTokens } from '../../../../editor/common/tokens/lineTokens.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
// import { IModelService } from '../../../../editor/common/services/model.js';

import * as dom from '../../../../base/browser/dom.js';
import { Widget } from '../../../../base/browser/ui/widget.js';
import { URI } from '../../../../base/common/uri.js';
import { ServiceSendLLMFeatureParams } from '../../../../platform/void/common/llmMessageTypes.js';
import { IConsistentItemService } from './helperServices/consistentItemService.js';
import { inlineDiff_systemMessage } from './prompt/prompts.js';
import { ILLMMessageService } from '../../../../platform/void/common/llmMessageService.js';
import { IPosition } from '../../../../editor/common/core/position.js';

import { mountCtrlK } from '../browser/react/out/ctrl-k-tsx/index.js'
import { QuickEditPropsType } from './quickEditActions.js';

const configOfBG = (color: Color) => {
	return { dark: color, light: color, hcDark: color, hcLight: color, }
}
// gets converted to --vscode-void-greenBG, see void.css
const greenBG = new Color(new RGBA(155, 185, 85, .3)); // default is RGBA(155, 185, 85, .2)
registerColor('void.greenBG', configOfBG(greenBG), '', true);

const redBG = new Color(new RGBA(255, 0, 0, .3)); // default is RGBA(255, 0, 0, .2)
registerColor('void.redBG', configOfBG(redBG), '', true);

const sweepBG = new Color(new RGBA(100, 100, 100, .2));
registerColor('void.sweepBG', configOfBG(sweepBG), '', true);

const highlightBG = new Color(new RGBA(100, 100, 100, .1));
registerColor('void.highlightBG', configOfBG(highlightBG), '', true);

const sweepIdxBG = new Color(new RGBA(100, 100, 100, .5));
registerColor('void.sweepIdxBG', configOfBG(sweepIdxBG), '', true);



// similar to ServiceLLM
export type StartStreamingOpts = {
	featureName: 'Ctrl+K';
	diffareaid: string; // id of the CtrlK area
} | {
	featureName: 'Ctrl+L';
} | {
	featureName: 'Autocomplete';
	range: IRange;
}




export type Diff = {
	diffid: number;
	diffareaid: number; // the diff area this diff belongs to, "computed"
} & ComputedDiff




// _ means anything we don't include if we clone it
// DiffArea.originalStartLine is the line in originalCode (not the file)

type CommonZoneProps = {
	diffareaid: number;
	startLine: number;
	endLine: number;

	_URI: URI; // typically we get the URI from model

	_removeStylesFns: Set<Function>; // these don't remove diffs or this diffArea, only their styles

}

type CtrlKZone = {
	type: 'CtrlKZone';
	originalCode?: undefined;
	userText: string;
} & CommonZoneProps


type DiffZone = {
	type: 'DiffZone',
	originalCode: string;
	_diffOfId: Record<string, Diff>; // diffid -> diff in this DiffArea
	_sweepState: {
		isStreaming: true;
		streamRequestIdRef: { current: string | null };
		line: number;
	} | {
		isStreaming: false;
		streamRequestIdRef?: undefined;
		line: null;
	};
	userText?: undefined;
} & CommonZoneProps



// called DiffArea for historical purposes, we can rename to something like TextRegion if we want
type DiffArea = CtrlKZone | DiffZone

const diffAreaSnapshotKeys = [
	'type',
	'diffareaid',
	'originalCode',
	'startLine',
	'endLine',
	'userText',
] as const satisfies (keyof DiffArea)[]

type DiffAreaSnapshot<DiffAreaType extends DiffArea = DiffArea> = Pick<DiffAreaType, typeof diffAreaSnapshotKeys[number]>



type HistorySnapshot = {
	snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshot>;
	entireFileCode: string;
} & ({
	type: 'Ctrl+K';
	ctrlKText: string;
} | {
	type: 'Ctrl+L';
})



export interface IInlineDiffsService {
	readonly _serviceBrand: undefined;
	startStreaming(params: , str: string): void;
}

export const IInlineDiffsService = createDecorator<IInlineDiffsService>('inlineDiffAreasService');

class InlineDiffsService extends Disposable implements IInlineDiffsService {
	_serviceBrand: undefined;


	// URI <--> model
	diffAreasOfURI: Record<string, Set<string>> = {}

	diffAreaOfId: Record<string, DiffArea> = {};
	diffOfId: Record<string, Diff> = {}; // redundant with diffArea._diffs



	_diffareaidPool = 0 // each diffarea has an id
	_diffidPool = 0 // each diff has an id

	constructor(
		// @IHistoryService private readonly _historyService: IHistoryService, // history service is the history of pressing alt left/right
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IModelService private readonly _modelService: IModelService,
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService, // undoRedo service is the history of pressing ctrl+z
		@ILanguageService private readonly _langService: ILanguageService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IConsistentItemService private readonly _zoneStyleService: IConsistentItemService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		// this function initializes data structures and listens for changes
		const initializeModel = (model: ITextModel) => {
			if (!(model.uri.fsPath in this.diffAreasOfURI)) {
				this.diffAreasOfURI[model.uri.fsPath] = new Set();
			}

			// when the user types, realign diff areas and re-render them
			this._register(
				model.onDidChangeContent(e => {
					// it's as if we just called _write, now all we need to do is realign and refresh
					if (this._weAreWriting) return
					const uri = model.uri
					for (const change of e.changes) { this._realignAllDiffAreasLines(uri, change.text, change.range) }
					this._refreshDiffsInURI(uri)

					// // diffArea should be removed if we just discovered it has no more diffs in it
					// for (const diffareaid of this.diffAreasOfURI[uri.fsPath]) {
					// 	const diffArea = this.diffAreaOfId[diffareaid]
					// 	if (Object.keys(diffArea._diffOfId).length === 0 && !diffArea._sweepState.isStreaming) {
					// 		const { onFinishEdit } = this._addToHistory(uri)
					// 		this._deleteDiffArea(diffArea)
					// 		onFinishEdit()
					// 	}
					// }


				})
			)
		}
		// initialize all existing models + initialize when a new model mounts
		for (let model of this._modelService.getModels()) { initializeModel(model) }
		this._register(this._modelService.onModelAdded(model => initializeModel(model)));


		// this function adds listeners to refresh styles when editor changes tab
		let initializeEditor = (editor: ICodeEditor) => {
			const uri = editor.getModel()?.uri ?? null
			if (uri) this._refreshDiffsInURI(uri)
		}
		// add listeners for all existing editors + listen for editor being added
		for (let editor of this._editorService.listCodeEditors()) { initializeEditor(editor) }
		this._register(this._editorService.onCodeEditorAdd(editor => { initializeEditor(editor) }))

	}




	// highlight the region
	private _addLineDecoration = (model: ITextModel | null, startLine: number, endLine: number, className: string, options?: Partial<IModelDecorationOptions>) => {
		if (model === null) return
		const id = model.changeDecorations(accessor => accessor.addDecoration(
			{ startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: Number.MAX_SAFE_INTEGER },
			{
				className: className,
				description: className,
				isWholeLine: true,
				...options
			}))
		const disposeHighlight = () => {
			if (id && !model.isDisposed()) model.changeDecorations(accessor => accessor.removeDecoration(id))
		}
		return disposeHighlight
	}



	private _addDiffAreaStylesToURI = (uri: URI) => {
		const model = this._getModel(uri)

		for (const diffareaid of this.diffAreasOfURI[uri.fsPath]) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (diffArea.type === 'DiffZone') {
				// add sweep styles to the diffZone
				if (diffArea._sweepState.isStreaming) {
					// sweepLine ... sweepLine
					const fn1 = this._addLineDecoration(model, diffArea._sweepState.line, diffArea._sweepState.line, 'void-sweepIdxBG')
					// sweepLine+1 ... endLine
					const fn2 = this._addLineDecoration(model, diffArea._sweepState.line + 1, diffArea.endLine, 'void-sweepBG')
					diffArea._removeStylesFns.add(() => { fn1?.(); fn2?.(); })
				}
			}
			// highlight the ctrlK zone
			if (diffArea.type === 'CtrlKZone') {

				const consistentZoneId = this._zoneStyleService.addConsistentItemToURI({
					uri,
					fn: (editor) => {
						const domNode = document.createElement('div');
						domNode.style.zIndex = '1'

						// domNode.className = 'void-redBG'
						const viewZone: IViewZone = {
							// afterLineNumber: computedDiff.startLine - 1,
							afterLineNumber: 1,
							heightInPx: 100,
							// heightInLines: 1,
							// minWidthInPx: 200,
							domNode: domNode,
							suppressMouseDown: false,
						};


						let zoneId: string | null = null
						editor.changeViewZones(accessor => { zoneId = accessor.addZone(viewZone) })
						const fn1 = () => editor.changeViewZones(accessor => { if (zoneId) accessor.removeZone(zoneId) })

						// on resize
						domNode.onresize = () => {
							viewZone.heightInPx = domNode.clientHeight
							editor.changeViewZones(accessor => { if (zoneId) accessor.layoutZone(zoneId) })
						}

						this._instantiationService.invokeFunction(accessor => {
							const props: QuickEditPropsType = {
								quickEditId: diffArea.diffareaid,
							}
							mountCtrlK(domNode, accessor, props)
						})

						return () => { fn1(); }
					},
				})
				diffArea._removeStylesFns.add(() => this._zoneStyleService.removeConsistentItemFromURI(consistentZoneId));

				const fn = this._addLineDecoration(model, diffArea.startLine, diffArea.endLine, 'void-highlightBG')
				diffArea._removeStylesFns.add(() => fn?.());
			}
		}
	}


	private _addDiffStylesToURI = (uri: URI, diff: Diff) => {
		const { type, diffid } = diff

		const disposeInThisEditorFns: (() => void)[] = []

		const model = this._modelService.getModel(uri)

		// green decoration and minimap decoration
		if (type !== 'deletion') {
			const fn = this._addLineDecoration(model, diff.startLine, diff.endLine, 'void-greenBG', {
				minimap: { color: { id: 'minimapGutter.addedBackground' }, position: 2 },
				overviewRuler: { color: { id: 'editorOverviewRuler.addedForeground' }, position: 7 }
			})
			disposeInThisEditorFns.push(() => { fn?.() })
		}


		// red in a view zone
		if (type !== 'insertion') {
			const consistentZoneId = this._zoneStyleService.addConsistentItemToURI({
				uri,
				fn: (editor) => {

					const domNode = document.createElement('div');
					domNode.className = 'void-redBG'

					const renderOptions = RenderOptions.fromEditor(editor);
					// applyFontInfo(domNode, renderOptions.fontInfo)

					// Compute view-lines based on redText
					const redText = diff.originalCode
					const lines = redText.split('\n');
					const lineTokens = lines.map(line => LineTokens.createFromTextAndMetadata([{ text: line, metadata: 0 }], this._langService.languageIdCodec));
					const source = new LineSource(lineTokens, lines.map(() => null), false, false)
					const result = renderLines(source, renderOptions, [], domNode);

					const viewZone: IViewZone = {
						// afterLineNumber: computedDiff.startLine - 1,
						afterLineNumber: type === 'edit' ? diff.endLine : diff.startLine - 1,
						heightInLines: result.heightInLines,
						minWidthInPx: result.minWidthInPx,
						domNode: domNode,
						marginDomNode: document.createElement('div'), // displayed to left
						suppressMouseDown: true,
					};

					let zoneId: string | null = null
					editor.changeViewZones(accessor => { zoneId = accessor.addZone(viewZone) })
					return () => editor.changeViewZones(accessor => { if (zoneId) accessor.removeZone(zoneId) })
				},
			})

			console.log('added (Z)', consistentZoneId)

			disposeInThisEditorFns.push(() => { console.log('removing (Z)', consistentZoneId); this._zoneStyleService.removeConsistentItemFromURI(consistentZoneId) })

		}



		// Accept | Reject widget
		const consistentWidgetId = this._zoneStyleService.addConsistentItemToURI({
			uri,
			fn: (editor) => {
				const buttonsWidget = new AcceptRejectWidget({
					editor,
					onAccept: () => { this.acceptDiff({ diffid }) },
					onReject: () => { this.rejectDiff({ diffid }) },
					diffid: diffid.toString(),
					startLine: diff.startLine,
				})
				return () => { buttonsWidget.dispose() }
			}
		})
		console.log('added (O)', consistentWidgetId)
		disposeInThisEditorFns.push(() => { console.log('removing (O)', consistentWidgetId); this._zoneStyleService.removeConsistentItemFromURI(consistentWidgetId) })



		const disposeInEditor = () => { disposeInThisEditorFns.forEach(f => f()) }
		return disposeInEditor;

	}



	private _getModel(uri: URI) {
		const model = this._modelService.getModel(uri)
		if (!model || model.isDisposed()) {
			return null
		}
		return model
	}
	private _readURI(uri: URI): string | null {
		return this._getModel(uri)?.getValue(EndOfLinePreference.LF) ?? null
	}
	private _getNumLines(uri: URI): number | null {
		return this._getModel(uri)?.getLineCount() ?? null
	}


	_weAreWriting = false
	private _writeText(uri: URI, text: string, range: IRange) {
		const model = this._getModel(uri)
		if (!model) return

		this._weAreWriting = true
		model.applyEdits([{ range, text }]) // applies edits without adding them to undo/redo stack
		this._weAreWriting = false

		this._realignAllDiffAreasLines(uri, text, range)
	}




	private _addToHistory(uri: URI) {

		const getCurrentSnapshot = (): HistorySnapshot => {
			const diffAreaOfId = this.diffAreaOfId

			const snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshot> = {}
			for (const diffareaid in diffAreaOfId) {
				const diffArea = diffAreaOfId[diffareaid]
				snapshottedDiffAreaOfId[diffareaid] = structuredClone( // a structured clone must be on a JSON object
					Object.fromEntries(diffAreaSnapshotKeys.map(key => [key, diffArea[key]]))
				) as DiffAreaSnapshot
			}
			return {
				snapshottedDiffAreaOfId,
				entireFileCode: this._readURI(uri) ?? '', // the whole file's code
				type: 'Ctrl+L',
			}
		}

		const restoreDiffAreas = (snapshot: HistorySnapshot) => {
			const { snapshottedDiffAreaOfId, entireFileCode: entireModelCode } = structuredClone(snapshot) // don't want to destroy the snapshot

			// delete all current decorations (diffs, sweep styles) so we don't have any unwanted leftover decorations
			this._clearAllEffects(uri)

			// __TODO__ stop streaming if currently streaming



			// restore diffAreaOfId and diffAreasOfModelId
			this.diffAreaOfId = {}
			this.diffAreasOfURI[uri.fsPath].clear()
			for (const diffareaid in snapshottedDiffAreaOfId) {

				const snapshottedDiffArea = snapshottedDiffAreaOfId[diffareaid]

				if (snapshottedDiffArea.type === 'DiffZone') {
					this.diffAreaOfId[diffareaid] = {
						...snapshottedDiffArea as DiffAreaSnapshot<DiffZone>,
						type: 'DiffZone',
						_diffOfId: {},
						_URI: uri,
						_sweepState: {
							isStreaming: false,
							line: null,
						} as const,
						_removeStylesFns: new Set(),
					}
				}
				else if (snapshottedDiffArea.type === 'CtrlKZone') {
					this.diffAreaOfId[diffareaid] = {
						...snapshottedDiffArea as DiffAreaSnapshot<CtrlKZone>,
						_URI: uri,
						_removeStylesFns: new Set(),
					}
				}
				this.diffAreasOfURI[uri.fsPath].add(diffareaid)
			}

			// restore file content
			const numLines = this._getNumLines(uri)
			if (numLines === null) return
			this._writeText(uri, entireModelCode, { startColumn: 1, startLineNumber: 1, endLineNumber: numLines, endColumn: Number.MAX_SAFE_INTEGER })

			// restore all the decorations
			this._refreshDiffsInURI(uri)
		}

		const beforeSnapshot: HistorySnapshot = getCurrentSnapshot()
		let afterSnapshot: HistorySnapshot | null = null

		const elt: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: uri,
			label: 'Void Changes',
			code: 'undoredo.inlineDiffs',
			undo: () => { restoreDiffAreas(beforeSnapshot) },
			redo: () => { if (afterSnapshot) restoreDiffAreas(afterSnapshot) }
		}
		this._undoRedoService.pushElement(elt)

		const onFinishEdit = () => { afterSnapshot = getCurrentSnapshot() }
		return { onFinishEdit }
	}


	// delete diffOfId and diffArea._diffOfId
	private _deleteDiff(diff: Diff) {
		const diffArea = this.diffAreaOfId[diff.diffareaid]
		if (diffArea.type !== 'DiffZone') return
		delete diffArea._diffOfId[diff.diffid]
		delete this.diffOfId[diff.diffid]
	}

	private _deleteDiffs(diffZone: DiffZone) {
		for (const diffid in diffZone._diffOfId) {
			const diff = diffZone._diffOfId[diffid]
			this._deleteDiff(diff)
		}
	}

	private _deleteEffects(diffArea: DiffArea) {
		// clear diffZone effects (diffs)
		if (diffArea.type === 'DiffZone')
			this._deleteDiffs(diffArea)
		else if (diffArea.type === 'CtrlKZone') {

		}

		diffArea._removeStylesFns.forEach(removeStyles => removeStyles())
	}

	// clears all Diffs (and their styles) and all styles of DiffAreas
	private _clearAllEffects(uri: URI) {
		for (let diffareaid of this.diffAreasOfURI[uri.fsPath]) {
			const diffArea = this.diffAreaOfId[diffareaid]
			this._deleteEffects(diffArea)
			diffArea._removeStylesFns.clear()
		}
	}



	// delete all diffs, update diffAreaOfId, update diffAreasOfModelId
	private _deleteDiffArea(diffArea: DiffArea) {
		// we had clear all diffs, but not really needed
		delete this.diffAreaOfId[diffArea.diffareaid]
		this.diffAreasOfURI[diffArea._URI.fsPath].delete(diffArea.diffareaid.toString())
	}





	// changes the start/line locations of all DiffAreas on the page (adjust their start/end based on the change) based on the change that was recently made
	private _realignAllDiffAreasLines(uri: URI, text: string, recentChange: { startLineNumber: number; endLineNumber: number }) {

		console.log('recent change', recentChange)

		const model = this._getModel(uri)
		if (!model) return

		// compute net number of newlines lines that were added/removed
		const startLine = recentChange.startLineNumber
		const endLine = recentChange.endLineNumber
		const changeRangeHeight = endLine - startLine + 1

		const newTextHeight = (text.match(/\n/g) || []).length + 1 // number of newlines is number of \n's + 1, e.g. "ab\ncd"

		const deltaNewlines = newTextHeight - changeRangeHeight

		// compute overlap with each diffArea and shrink/elongate each diffArea accordingly
		for (const diffareaid of this.diffAreasOfURI[model.uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]

			// if the diffArea is above the range, it is not affected
			if (startLine > diffArea.endLine + 1) {
				console.log('A')
				continue
			}

			// console.log('Changing DiffArea:', diffArea.startLine, diffArea.endLine)

			// if the diffArea fully contains the change, elongate it by the delta amount of newlines
			if (startLine >= diffArea.startLine && endLine <= diffArea.endLine) {
				diffArea.endLine += deltaNewlines
			}
			// if the change fully contains the diffArea, make the diffArea have the same range as the change
			else if (diffArea.startLine > startLine && diffArea.endLine < endLine) {

				diffArea.startLine = startLine
				diffArea.endLine = startLine + newTextHeight
				console.log('B', diffArea.startLine, diffArea.endLine)
			}
			// if the change contains only the diffArea's top
			else if (diffArea.startLine > startLine) {
				// TODO fill in this case
				console.log('C', diffArea.startLine, diffArea.endLine)
			}
			// if the change contains only the diffArea's bottom
			else if (diffArea.endLine < endLine) {
				const numOverlappingLines = diffArea.endLine - startLine + 1
				diffArea.endLine += newTextHeight - numOverlappingLines // TODO double check this
				console.log('D', diffArea.startLine, diffArea.endLine)
			}
			// if a diffArea is below the last character of the change, shift the diffArea up/down by the delta amount of newlines
			else if (diffArea.startLine > endLine) {
				diffArea.startLine += deltaNewlines
				diffArea.endLine += deltaNewlines
				console.log('E', diffArea.startLine, diffArea.endLine)
			}

			// console.log('To:', diffArea.startLine, diffArea.endLine)
		}

	}


	private _refreshDiffsInURI(uri: URI) {
		const content = this._readURI(uri)
		if (content === null) return

		// 1. clear Diffs and styles
		this._clearAllEffects(uri)

		// 2. recompute all diffs on each editor with this URI

		const fullFileText = this._readURI(uri) ?? ''


		// go thru all diffareas in this URI, creating diffs and adding styles to it
		for (let diffareaid of this.diffAreasOfURI[uri.fsPath]) {
			const diffArea = this.diffAreaOfId[diffareaid]

			if (diffArea.type === 'DiffZone') {

				console.log('DA start and end:', diffArea.startLine, diffArea.endLine)
				const newDiffAreaCode = fullFileText.split('\n').slice((diffArea.startLine - 1), (diffArea.endLine - 1) + 1).join('\n')
				const computedDiffs = findDiffs(diffArea.originalCode, newDiffAreaCode)

				for (let computedDiff of computedDiffs) {
					const diffid = this._diffidPool++

					// create a Diff of it
					const newDiff: Diff = {
						...computedDiff,
						diffid: diffid,
						diffareaid: diffArea.diffareaid,
					}

					const fn = this._addDiffStylesToURI(uri, newDiff)
					diffArea._removeStylesFns.add(fn)

					this.diffOfId[diffid] = newDiff
					diffArea._diffOfId[diffid] = newDiff
				}
			}

			// update styles on this DiffArea
			this._addDiffAreaStylesToURI(uri)
		}


	}


	// @throttle(100)
	private _writeDiffZoneLLMText(diffArea: DiffArea, llmText: string, latestCurrentFileEnd: IPosition, newPosition: IPosition) {

		if (diffArea.type !== 'DiffZone') return
		// ----------- 1. Write the new code to the document -----------
		// figure out where to highlight based on where the AI is in the stream right now, use the last diff to figure that out
		const uri = diffArea._URI
		const computedDiffs = findDiffs(diffArea.originalCode, llmText)

		// if not streaming, just write the new code
		if (!diffArea._sweepState.isStreaming) {
			this._writeText(uri, llmText,
				{ startLineNumber: diffArea.startLine, startColumn: 1, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, } // 1-indexed
			)
		}
		// if streaming, use diffs to figure out where to write new code
		else {
			// these are two different coordinate systems - new and old line number
			let newFileEndLine: number // get new[0...newStoppingPoint] with line=newStoppingPoint highlighted
			let oldFileStartLine: number // get original[oldStartingPoint...]

			const lastDiff = computedDiffs.pop()

			if (!lastDiff) {
				// if the writing is identical so far, display no changes
				newFileEndLine = 1
				oldFileStartLine = 1
			}
			else {
				if (lastDiff.type === 'insertion') {
					newFileEndLine = lastDiff.endLine
					oldFileStartLine = lastDiff.originalStartLine
				}
				else if (lastDiff.type === 'deletion') {
					newFileEndLine = lastDiff.startLine
					oldFileStartLine = lastDiff.originalStartLine
				}
				else if (lastDiff.type === 'edit') {
					newFileEndLine = lastDiff.endLine
					oldFileStartLine = lastDiff.originalStartLine
				}
				else {
					throw new Error(`Void: diff.type not recognized on: ${lastDiff}`)
				}
			}

			diffArea._sweepState.line = newFileEndLine

			// lines are 1-indexed
			const newFileTop = llmText.split('\n').slice(0, (newFileEndLine - 1)).join('\n')
			const oldFileBottom = diffArea.originalCode.split('\n').slice((oldFileStartLine - 1), Infinity).join('\n')

			const newCode = `${newFileTop}\n${oldFileBottom}`

			this._writeText(uri, newCode,
				{ startLineNumber: diffArea.startLine, startColumn: 1, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, } // 1-indexed
			)

		}

		return computedDiffs

	}




	private _initializeStream(featureParams: ServiceSendLLMFeatureParams, diffRepr: string, uri: URI,): DiffZone | undefined {

		// diff area begin and end line
		const numLines = this._getNumLines(uri)
		if (numLines === null) return

		const beginLine = 1
		const endLine = numLines

		// check if there's overlap with any other diffAreas and return early if there is
		for (const diffareaid of this.diffAreasOfURI[uri.fsPath]) {
			const da2 = this.diffAreaOfId[diffareaid]
			if (!da2) continue
			const noOverlap = da2.startLine > endLine || da2.endLine < beginLine
			if (!noOverlap) {
				// TODO add a message here that says this to the user too
				console.error('Not diffing because found overlap:', this.diffAreasOfURI[uri.fsPath], beginLine, endLine)
				return
			}
		}

		const currentFileStr = this._readURI(uri)
		if (currentFileStr === null) return
		const originalCode = currentFileStr.split('\n').slice((beginLine - 1), (endLine - 1) + 1).join('\n')


		let streamRequestIdRef: { current: string | null } = { current: null }


		// add to history
		const { onFinishEdit } = this._addToHistory(uri)

		// create a diffArea for the stream
		const diffareaid = this._diffareaidPool++

		// in ctrl+L the start and end lines are the full document
		const diffArea: DiffZone = {
			type: 'DiffZone',
			diffareaid: diffareaid,
			// originalStartLine: beginLine,
			// originalEndLine: endLine,
			originalCode: originalCode,
			startLine: beginLine,
			endLine: endLine, // starts out the same as the current file
			_URI: uri,
			_sweepState: {
				isStreaming: true,
				streamRequestIdRef,
				line: 1,
			},
			_diffOfId: {}, // added later
			_removeStylesFns: new Set(),
		}

		// console.log('adding uri.fspath', uri.fsPath, diffArea.diffareaid.toString())
		this.diffAreasOfURI[uri.fsPath].add(diffArea.diffareaid.toString())
		this.diffAreaOfId[diffArea.diffareaid] = diffArea

		// actually call the LLM
		const promptContent = `\
ORIGINAL_CODE
\`\`\`
${originalCode}
\`\`\`

DIFF
\`\`\`
${diffRepr}
\`\`\`

INSTRUCTIONS
Please finish writing the new file by applying the diff to the original file. Return ONLY the completion of the file, without any explanation.
`


		const latestCurrentFileEnd: IPosition = { lineNumber: 1, column: 1 }
		const latestOriginalFileStart: IPosition = { lineNumber: 1, column: 1 }

		streamRequestIdRef.current = this._llmMessageService.sendLLMMessage({
			logging: { loggingName: 'streamChunk' },
			messages: [
				{ role: 'system', content: inlineDiff_systemMessage, },
				// TODO include more context too
				{ role: 'user', content: promptContent, }
			],
			onText: ({ newText, fullText }) => {
				this._writeDiffZoneLLMText(diffArea, fullText, latestCurrentFileEnd, latestOriginalFileStart)
				this._refreshDiffsInURI(uri)
			},
			onFinalMessage: ({ fullText }) => {
				this._writeText(uri, fullText,
					{ startLineNumber: diffArea.startLine, startColumn: 1, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER }, // 1-indexed
				)
				diffArea._sweepState = { isStreaming: false, line: null }
				this._refreshDiffsInURI(uri)
				onFinishEdit()
			},
			onError: (e) => {
				console.error('Error rewriting file with diff', e);
				// TODO indicate there was an error
				if (streamRequestIdRef.current)
					this._llmMessageService.abort(streamRequestIdRef.current)

				diffArea._sweepState = { isStreaming: false, line: null }
				onFinishEdit()
			},
			...featureParams
		})


		return diffArea

	}






	async startStreaming(opts: StartStreamingOpts, userMessage: string) {
		const editor = this._editorService.getActiveCodeEditor()
		if (!editor) return
		const uri = editor.getModel()?.uri
		if (!uri) return
		// TODO reject all diffs in the diff area
		// TODO deselect user's cursor
		const addedDiffZone = this._initializeStream(opts, userMessage, uri)
		return addedDiffZone?.diffareaid
	}


	private _stopIfStreaming(diffZone: DiffZone) {

	}



	interruptStreaming(diffareaid: string) {
		const diffArea = this.diffAreaOfId[diffareaid]

		if (!diffArea) return
		if (diffArea.type !== 'DiffZone') return
		if (!diffArea._sweepState.isStreaming) return

		const streamRequestId = diffArea._sweepState.streamRequestIdRef.current
		if (streamRequestId)
			this._llmMessageService.abort(streamRequestId)

		// __TODO__ update diffArea streamState here + don't elsewhere
		// call undo - __TODO__ make this get called in undo and redo too

		this._undoRedoService.undo(diffArea._URI)

	}





	addCtrlK({ uri, range }: { uri: URI, range: IRange, }) {

		// TODO check if intersects with a current ctrl K, if so focus it

	}





	// called on void.acceptDiff
	public async acceptDiff({ diffid }: { diffid: number }) {

		const diff = this.diffOfId[diffid]
		if (!diff) return

		const { diffareaid } = diff
		const diffArea = this.diffAreaOfId[diffareaid]
		if (!diffArea) return

		if (diffArea.type !== 'DiffZone') return

		const uri = diffArea._URI

		// add to history
		const { onFinishEdit } = this._addToHistory(uri)

		const originalLines = diffArea.originalCode.split('\n')
		let newOriginalCode: string

		if (diff.type === 'deletion') {
			newOriginalCode = [
				...originalLines.slice(0, (diff.originalStartLine - 1)), // everything before startLine
				// <-- deletion has nothing here
				...originalLines.slice((diff.originalEndLine - 1) + 1, Infinity) // everything after endLine
			].join('\n')
		}
		else if (diff.type === 'insertion') {
			newOriginalCode = [
				...originalLines.slice(0, (diff.originalStartLine - 1)), // everything before startLine
				diff.code, // code
				...originalLines.slice((diff.originalStartLine - 1), Infinity) // startLine (inclusive) and on (no +1)
			].join('\n')
		}
		else if (diff.type === 'edit') {
			newOriginalCode = [
				...originalLines.slice(0, (diff.originalStartLine - 1)), // everything before startLine
				diff.code, // code
				...originalLines.slice((diff.originalEndLine - 1) + 1, Infinity) // everything after endLine
			].join('\n')
		}
		else {
			throw new Error(`Void error: ${diff}.type not recognized`)
		}

		// console.log('DIFF', diff)
		// console.log('DIFFAREA', diffArea)
		// console.log('ORIGINAL', diffArea.originalCode)
		// console.log('new original Code', newOriginalCode)

		// update code now accepted as original
		diffArea.originalCode = newOriginalCode

		// delete the diff
		this._deleteDiff(diff)

		// diffArea should be removed if it has no more diffs in it
		if (Object.keys(diffArea._diffOfId).length === 0) {
			this._deleteDiffArea(diffArea)
		}

		this._refreshDiffsInURI(uri)

		onFinishEdit()

	}



	// called on void.rejectDiff
	public async rejectDiff({ diffid }: { diffid: number }) {

		const diff = this.diffOfId[diffid]
		if (!diff) return

		const { diffareaid } = diff
		const diffArea = this.diffAreaOfId[diffareaid]
		if (!diffArea) return

		if (diffArea.type !== 'DiffZone') return

		const uri = diffArea._URI

		// add to history
		const { onFinishEdit } = this._addToHistory(uri)

		let writeText: string
		let toRange: IRange

		// if it was a deletion, need to re-insert
		// (this image applies to writeText and toRange, not newOriginalCode)
		//  A
		// |B   <-- deleted here, diff.startLine == diff.endLine
		//  C
		if (diff.type === 'deletion') {
			// if startLine is out of bounds (deleted lines past the diffarea), applyEdit will do a weird rounding thing, to account for that we apply the edit the line before
			if (diff.startLine - 1 === diffArea.endLine) {
				writeText = '\n' + diff.originalCode
				toRange = { startLineNumber: diff.startLine - 1, startColumn: Number.MAX_SAFE_INTEGER, endLineNumber: diff.startLine - 1, endColumn: Number.MAX_SAFE_INTEGER }
			}
			else {
				writeText = diff.originalCode + '\n'
				toRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.startLine, endColumn: 1 }
			}
		}
		// if it was an insertion, need to delete all the lines
		// (this image applies to writeText and toRange, not newOriginalCode)
		// |A   <-- startLine
		//  B|  <-- endLine (we want to delete this whole line)
		//  C
		else if (diff.type === 'insertion') {
			writeText = ''
			toRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.endLine + 1, endColumn: 1 } // 1-indexed
		}
		// if it was an edit, just edit the range
		// (this image applies to writeText and toRange, not newOriginalCode)
		// |A    <-- startLine
		//  B|   <-- endLine (just swap out these lines for the originalCode)
		//  C
		else if (diff.type === 'edit') {
			writeText = diff.originalCode
			toRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.endLine, endColumn: Number.MAX_SAFE_INTEGER } // 1-indexed
		}
		else {
			throw new Error(`Void error: ${diff}.type not recognized`)
		}

		console.log('REJECTION start, end:', diffArea.startLine, diffArea.endLine)
		// update the file
		this._writeText(uri, writeText, toRange)

		console.log('2REJECTION start, end:', diffArea.startLine, diffArea.endLine)

		// originalCode does not change!

		// delete the diff
		this._deleteDiff(diff)

		// diffArea should be removed if it has no more diffs in it
		if (Object.keys(diffArea._diffOfId).length === 0) {
			this._deleteDiffArea(diffArea)
		}

		this._refreshDiffsInURI(uri)

		onFinishEdit()

	}

}

registerSingleton(IInlineDiffsService, InlineDiffsService, InstantiationType.Eager);




class AcceptRejectWidget extends Widget implements IOverlayWidget {

	public getId() { return this.ID }
	public getDomNode() { return this._domNode; }
	public getPosition() { return null }

	private readonly _domNode: HTMLElement;
	private readonly editor
	private readonly ID
	private readonly startLine

	constructor({ editor, onAccept, onReject, diffid, startLine }: { editor: ICodeEditor; onAccept: () => void; onReject: () => void; diffid: string, startLine: number }) {
		super()

		this.ID = editor.getModel()?.uri.fsPath + diffid;
		this.editor = editor;
		this.startLine = startLine;

		// Create container div with buttons
		const { acceptButton, rejectButton, buttons } = dom.h('div@buttons', [
			dom.h('button@acceptButton', []),
			dom.h('button@rejectButton', [])
		]);

		// Style the container
		buttons.style.display = 'flex';
		buttons.style.position = 'absolute';
		buttons.style.gap = '4px';
		buttons.style.padding = '4px';
		buttons.style.zIndex = '1000';


		// Style accept button
		acceptButton.onclick = onAccept;
		acceptButton.textContent = 'Accept';
		acceptButton.style.backgroundColor = '#28a745';
		acceptButton.style.color = 'white';
		acceptButton.style.border = 'none';
		acceptButton.style.padding = '4px 8px';
		acceptButton.style.borderRadius = '3px';
		acceptButton.style.cursor = 'pointer';

		// Style reject button
		rejectButton.onclick = onReject;
		rejectButton.textContent = 'Reject';
		rejectButton.style.backgroundColor = '#dc3545';
		rejectButton.style.color = 'white';
		rejectButton.style.border = 'none';
		rejectButton.style.padding = '4px 8px';
		rejectButton.style.borderRadius = '3px';
		rejectButton.style.cursor = 'pointer';

		this._domNode = buttons;

		const updateTop = () => {
			const topPx = editor.getTopForLineNumber(this.startLine) - editor.getScrollTop()
			this._domNode.style.top = `${topPx}px`
		}
		const updateLeft = () => {
			const leftPx = 0//editor.getScrollLeft() - editor.getScrollWidth()
			this._domNode.style.left = `${leftPx}px`
		}

		updateTop()
		updateLeft()

		this._register(editor.onDidScrollChange(e => { updateTop() }))
		this._register(editor.onDidChangeModelContent(e => { updateTop() }))
		this._register(editor.onDidLayoutChange(e => { updateTop(); updateLeft() }))

		// mount this widget

		editor.addOverlayWidget(this);
		// console.log('created elt', this._domNode)
	}

	public override dispose(): void {
		this.editor.removeOverlayWidget(this)
		super.dispose()
	}

}


