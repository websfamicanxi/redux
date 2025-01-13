/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor, IOverlayWidget, IViewZone } from '../../../../editor/browser/editorBrowser.js';

// import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
// import { throttle } from '../../../../base/common/decorators.js';
import { ComputedDiff, findDiffs } from './helpers/findDiffs.js';
import { EndOfLinePreference, IModelDecorationOptions, ITextModel } from '../../../../editor/common/model.js';
import { IRange, Range } from '../../../../editor/common/core/range.js';
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
import { IConsistentEditorItemService, IConsistentItemService } from './helperServices/consistentItemService.js';
import { ctrlKStream_prefixAndSuffix, ctrlKStream_prompt, ctrlKStream_systemMessage, ctrlLStream_prompt, ctrlLStream_systemMessage, defaultFimTags } from './prompt/prompts.js';
import { ILLMMessageService } from '../../../../platform/void/common/llmMessageService.js';

import { mountCtrlK } from '../browser/react/out/quick-edit-tsx/index.js'
import { QuickEditPropsType } from './quickEditActions.js';
import { errorDetails, LLMMessage } from '../../../../platform/void/common/llmMessageTypes.js';
import { IModelContentChangedEvent } from '../../../../editor/common/textModelEvents.js';
import { extractCodeFromFIM, extractCodeFromRegular } from './helpers/extractCodeFromResult.js';
import { IMetricsService } from '../../../../platform/void/common/metricsService.js';
import { InlineDecorationType } from '../../../../editor/common/viewModel.js';
import { filenameToVscodeLanguage } from './helpers/detectLanguage.js';
import { BaseEditorSimpleWorker } from '../../../../editor/common/services/editorSimpleWorker.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize2 } from '../../../../nls.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { isMacintosh } from '../../../../base/common/platform.js';

const configOfBG = (color: Color) => {
	return { dark: color, light: color, hcDark: color, hcLight: color, }
}
// gets converted to --vscode-void-greenBG, see void.css, asCssVariable
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
export type StartApplyingOpts = {
	featureName: 'Ctrl+K';
	diffareaid: number; // id of the CtrlK area (contains text selection)
	userMessage: string; // user message
} | {
	featureName: 'Ctrl+L';
	userMessage: string;
} | {
	featureName: 'Autocomplete';
	range: IRange;
	userMessage: string;
}

export type AddCtrlKOpts = {
	startLine: number,
	endLine: number,
	editor: ICodeEditor,
}

// // TODO diffArea should be removed if we just discovered it has no more diffs in it
// for (const diffareaid of this.diffAreasOfURI[uri.fsPath]) {
// 	const diffArea = this.diffAreaOfId[diffareaid]
// 	if (Object.keys(diffArea._diffOfId).length === 0 && !diffArea._sweepState.isStreaming) {
// 		const { onFinishEdit } = this._addToHistory(uri)
// 		this._deleteDiffArea(diffArea)
// 		onFinishEdit()
// 	}
// }


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

	editorId: string; // the editor the input lives on

	_mountInfo: null | {
		textAreaRef: { current: HTMLTextAreaElement | null }
		dispose: () => void;
		refresh: () => void;
	}

} & CommonZoneProps


type DiffZone = {
	type: 'DiffZone',
	originalCode: string;
	_diffOfId: Record<string, Diff>; // diffid -> diff in this DiffArea
	_streamState: {
		isStreaming: true;
		streamRequestIdRef: { current: string | null };
		line: number;
	} | {
		isStreaming: false;
		streamRequestIdRef?: undefined;
		line?: undefined;
	};
	editorId?: undefined;
} & CommonZoneProps



// called DiffArea for historical purposes, we can rename to something like TextRegion if we want
type DiffArea = CtrlKZone | DiffZone

const diffAreaSnapshotKeys = [
	'type',
	'diffareaid',
	'originalCode',
	'startLine',
	'endLine',
	'editorId',
] as const satisfies (keyof DiffArea)[]

type DiffAreaSnapshot<DiffAreaType extends DiffArea = DiffArea> = Pick<DiffAreaType, typeof diffAreaSnapshotKeys[number]>



type HistorySnapshot = {
	snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshot>;
	entireFileCode: string;
}



export interface IInlineDiffsService {
	readonly _serviceBrand: undefined;
	startApplying(opts: StartApplyingOpts): number | undefined;
	interruptStreaming(diffareaid: number): void;
	addCtrlKZone(opts: AddCtrlKOpts): number | undefined;
	removeCtrlKZone(opts: { diffareaid: number }): void;

	testDiffs(): void;
}

export const IInlineDiffsService = createDecorator<IInlineDiffsService>('inlineDiffAreasService');

class InlineDiffsService extends Disposable implements IInlineDiffsService {
	_serviceBrand: undefined;


	// URI <--> model
	diffAreasOfURI: Record<string, Set<string>> = {}

	diffAreaOfId: Record<string, DiffArea> = {};
	diffOfId: Record<string, Diff> = {}; // redundant with diffArea._diffs


	constructor(
		// @IHistoryService private readonly _historyService: IHistoryService, // history service is the history of pressing alt left/right
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IModelService private readonly _modelService: IModelService,
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService, // undoRedo service is the history of pressing ctrl+z
		@ILanguageService private readonly _langService: ILanguageService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IConsistentItemService private readonly _consistentItemService: IConsistentItemService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IConsistentEditorItemService private readonly _consistentEditorItemService: IConsistentEditorItemService,
		@IMetricsService private readonly _metricsService: IMetricsService,
		@INotificationService private readonly _notificationService: INotificationService,
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
					if (this.weAreWriting) return
					const uri = model.uri
					this._onUserChangeContent(uri, e)
				})
			)
		}
		// initialize all existing models + initialize when a new model mounts
		for (let model of this._modelService.getModels()) { initializeModel(model) }
		this._register(this._modelService.onModelAdded(model => initializeModel(model)));


		// this function adds listeners to refresh styles when editor changes tab
		let initializeEditor = (editor: ICodeEditor) => {
			const uri = editor.getModel()?.uri ?? null
			if (uri) this._refreshStylesAndDiffsInURI(uri)
		}
		// add listeners for all existing editors + listen for editor being added
		for (let editor of this._editorService.listCodeEditors()) { initializeEditor(editor) }
		this._register(this._editorService.onCodeEditorAdd(editor => { initializeEditor(editor) }))

	}


	private _onUserChangeContent(uri: URI, e: IModelContentChangedEvent) {
		for (const change of e.changes) {
			this._realignAllDiffAreasLines(uri, change.text, change.range)
		}
		this._refreshStylesAndDiffsInURI(uri)
	}

	private _onInternalChangeContent(uri: URI, { shouldRealign }: { shouldRealign: false | { newText: string, oldRange: IRange } }) {
		if (shouldRealign) {
			const { newText, oldRange } = shouldRealign
			// console.log('realiging', newText, oldRange)
			this._realignAllDiffAreasLines(uri, newText, oldRange)
		}
		this._refreshStylesAndDiffsInURI(uri)

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
				if (diffArea._streamState.isStreaming) {
					// sweepLine ... sweepLine
					const fn1 = this._addLineDecoration(model, diffArea._streamState.line, diffArea._streamState.line, 'void-sweepIdxBG')
					// sweepLine+1 ... endLine
					const fn2 = this._addLineDecoration(model, diffArea._streamState.line + 1, diffArea.endLine, 'void-sweepBG')
					diffArea._removeStylesFns.add(() => { fn1?.(); fn2?.(); })

				}
			}

			else if (diffArea.type === 'CtrlKZone') {
				// highlight zone's text
				const fn = this._addLineDecoration(model, diffArea.startLine, diffArea.endLine, 'void-highlightBG')
				diffArea._removeStylesFns.add(() => fn?.());
			}
		}
	}


	private _computeDiffsAndAddStylesToURI = (uri: URI) => {
		const fullFileText = this._readURI(uri) ?? ''

		for (const diffareaid of this.diffAreasOfURI[uri.fsPath]) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (diffArea.type !== 'DiffZone') continue

			const newDiffAreaCode = fullFileText.split('\n').slice((diffArea.startLine - 1), (diffArea.endLine - 1) + 1).join('\n')
			const computedDiffs = findDiffs(diffArea.originalCode, newDiffAreaCode)
			for (let computedDiff of computedDiffs) {
				if (computedDiff.type === 'deletion') {
					computedDiff.startLine += diffArea.startLine - 1
				}
				if (computedDiff.type === 'edit' || computedDiff.type === 'insertion') {
					computedDiff.startLine += diffArea.startLine - 1
					computedDiff.endLine += diffArea.startLine - 1
				}
				this._addDiff(computedDiff, diffArea)
			}

		}
	}


	mostRecentTextOfCtrlKZoneId: Record<string, string | undefined> = {}
	private _addCtrlKZoneInput = (ctrlKZone: CtrlKZone) => {

		const { editorId } = ctrlKZone
		const editor = this._editorService.listCodeEditors().find(e => e.getId() === editorId)
		if (!editor) { return null }

		let zoneId: string | null = null
		let viewZone_: IViewZone | null = null
		const textAreaRef: { current: HTMLTextAreaElement | null } = { current: null }

		const itemId = this._consistentEditorItemService.addToEditor(editor, () => {
			const domNode = document.createElement('div');
			domNode.style.zIndex = '1'
			domNode.style.height = 'auto'
			const viewZone: IViewZone = {
				afterLineNumber: ctrlKZone.startLine - 1,
				domNode: domNode,
				// heightInPx: 80,
				suppressMouseDown: false,
				showInHiddenAreas: true,
			};
			viewZone_ = viewZone

			// mount zone
			editor.changeViewZones(accessor => {
				zoneId = accessor.addZone(viewZone)
			})


			// mount react
			this._instantiationService.invokeFunction(accessor => {
				mountCtrlK(domNode, accessor, {

					diffareaid: ctrlKZone.diffareaid,

					textAreaRef: (r) => {
						textAreaRef.current = r
						if (!textAreaRef.current) return

						if (!(ctrlKZone.diffareaid in this.mostRecentTextOfCtrlKZoneId)) { // detect first mount this way (a hack)
							this.mostRecentTextOfCtrlKZoneId[ctrlKZone.diffareaid] = undefined
							setTimeout(() => textAreaRef.current?.focus(), 100)
						}
					},
					onChangeHeight(height) {
						viewZone.heightInPx = height
						// re-render with this new height
						editor.changeViewZones(accessor => {
							if (zoneId) accessor.layoutZone(zoneId)
						})
					},
					onChangeText: (text) => {
						this.mostRecentTextOfCtrlKZoneId[ctrlKZone.diffareaid] = text;
					},
					initText: this.mostRecentTextOfCtrlKZoneId[ctrlKZone.diffareaid] ?? null,
				} satisfies QuickEditPropsType)

			})

			return () => editor.changeViewZones(accessor => {
				if (zoneId)
					accessor.removeZone(zoneId)
			})
		})

		return {
			textAreaRef,
			refresh: () => editor.changeViewZones(accessor => {
				if (zoneId && viewZone_) {
					viewZone_.afterLineNumber = ctrlKZone.startLine - 1
					accessor.layoutZone(zoneId)
				}
			}),
			dispose: () => {
				this._consistentEditorItemService.removeFromEditor(itemId)
			},
		} satisfies CtrlKZone['_mountInfo']
	}



	private _refreshCtrlKInputs = async (uri: URI) => {
		for (const diffareaid of this.diffAreasOfURI[uri.fsPath]) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (diffArea.type !== 'CtrlKZone') continue
			if (!diffArea._mountInfo) {
				diffArea._mountInfo = this._addCtrlKZoneInput(diffArea)
				// console.log('MOUNTED', diffArea.diffareaid)
			}
			else {
				diffArea._mountInfo.refresh()
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
			const consistentZoneId = this._consistentItemService.addConsistentItemToURI({
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
					const result = renderLines(source, renderOptions, [
						{ // add dummy so it doesn't highlight in red
							range: Range.lift({ startLineNumber: 1, startColumn: 1, endLineNumber: Number.MAX_SAFE_INTEGER, endColumn: Number.MAX_SAFE_INTEGER }),
							inlineClassName: '',
							type: InlineDecorationType.Regular
						}
					], domNode);

					const viewZone: IViewZone = {
						// afterLineNumber: computedDiff.startLine - 1,
						afterLineNumber: type === 'edit' ? diff.endLine : diff.startLine - 1,
						heightInLines: result.heightInLines,
						minWidthInPx: result.minWidthInPx,
						domNode: domNode,
						marginDomNode: document.createElement('div'), // displayed to left
						suppressMouseDown: true,
						showInHiddenAreas: true,
					};

					let zoneId: string | null = null
					editor.changeViewZones(accessor => { zoneId = accessor.addZone(viewZone) })
					return () => editor.changeViewZones(accessor => { if (zoneId) accessor.removeZone(zoneId) })
				},
			})

			disposeInThisEditorFns.push(() => { this._consistentItemService.removeConsistentItemFromURI(consistentZoneId) })

		}



		// Accept | Reject widget
		const consistentWidgetId = this._consistentItemService.addConsistentItemToURI({
			uri,
			fn: (editor) => {
				const buttonsWidget = new AcceptRejectWidget({
					editor,
					onAccept: () => {
						this.acceptDiff({ diffid })
						this._metricsService.capture('Accept Diff', { batch: false })
					},
					onReject: () => {
						this.rejectDiff({ diffid })
						this._metricsService.capture('Reject Diff', { batch: false })
					},
					diffid: diffid.toString(),
					startLine: diff.startLine,
				})
				return () => { buttonsWidget.dispose() }
			}
		})
		disposeInThisEditorFns.push(() => { this._consistentItemService.removeConsistentItemFromURI(consistentWidgetId) })



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
	private _readURI(uri: URI, range?: IRange): string | null {
		if (!range) return this._getModel(uri)?.getValue(EndOfLinePreference.LF) ?? null
		else return this._getModel(uri)?.getValueInRange(range, EndOfLinePreference.LF) ?? null
	}
	private _getNumLines(uri: URI): number | null {
		return this._getModel(uri)?.getLineCount() ?? null
	}
	private _getActiveEditorURI(): URI | null {
		const editor = this._editorService.getActiveCodeEditor()
		if (!editor) return null
		const uri = editor.getModel()?.uri
		if (!uri) return null
		return uri
	}

	weAreWriting = false
	worker = new BaseEditorSimpleWorker()
	private async _writeText(uri: URI, text: string, range: IRange, { shouldRealignDiffAreas }: { shouldRealignDiffAreas: boolean }) {
		const model = this._getModel(uri)
		if (!model) return
		const uriStr = this._readURI(uri, range)
		if (!uriStr) return

		// minimal edits so not so flashy
		// __TODO__ THIS IS NOT INSIDE A WORKER, SO IT MIGHT BE SLOW, we should instead just do an optimal write ourselves
		const edits = this.worker.$Void_computeMoreMinimalEdits(uri.toString(), [{ range, text }], false)

		if (edits) {
			this.weAreWriting = true
			model.applyEdits(edits)
			this.weAreWriting = false
		}

		this._onInternalChangeContent(uri, { shouldRealign: shouldRealignDiffAreas && { newText: text, oldRange: range } })
	}




	private _addToHistory(uri: URI) {

		const getCurrentSnapshot = (): HistorySnapshot => {
			const snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshot> = {}

			for (const diffareaid in this.diffAreaOfId) {
				const diffArea = this.diffAreaOfId[diffareaid]

				if (diffArea._URI.fsPath !== uri.fsPath) continue

				snapshottedDiffAreaOfId[diffareaid] = structuredClone( // a structured clone must be on a JSON object
					Object.fromEntries(diffAreaSnapshotKeys.map(key => [key, diffArea[key]]))
				) as DiffAreaSnapshot
			}
			return {
				snapshottedDiffAreaOfId,
				entireFileCode: this._readURI(uri) ?? '', // the whole file's code
			}
		}

		const restoreDiffAreas = (snapshot: HistorySnapshot) => {

			// for each diffarea in this uri, stop streaming if currently streaming
			for (const diffareaid in this.diffAreaOfId) {
				const diffArea = this.diffAreaOfId[diffareaid]
				if (diffArea.type === 'DiffZone')
					this._stopIfStreaming(diffArea)
			}

			// delete all diffareas on this uri (clearing their styles)
			this._deleteAllDiffAreas(uri)
			this.diffAreasOfURI[uri.fsPath].clear()

			const { snapshottedDiffAreaOfId, entireFileCode: entireModelCode } = structuredClone(snapshot) // don't want to destroy the snapshot

			// restore diffAreaOfId and diffAreasOfModelId
			for (const diffareaid in snapshottedDiffAreaOfId) {

				const snapshottedDiffArea = snapshottedDiffAreaOfId[diffareaid]

				if (snapshottedDiffArea.type === 'DiffZone') {
					this.diffAreaOfId[diffareaid] = {
						...snapshottedDiffArea as DiffAreaSnapshot<DiffZone>,
						type: 'DiffZone',
						_diffOfId: {},
						_URI: uri,
						_streamState: { isStreaming: false },
						_removeStylesFns: new Set(),
					}
				}
				else if (snapshottedDiffArea.type === 'CtrlKZone') {
					this.diffAreaOfId[diffareaid] = {
						...snapshottedDiffArea as DiffAreaSnapshot<CtrlKZone>,
						_URI: uri,
						_removeStylesFns: new Set(),
						_mountInfo: null,
					}
				}
				this.diffAreasOfURI[uri.fsPath].add(diffareaid)
			}

			// restore file content
			const numLines = this._getNumLines(uri)
			if (numLines === null) return

			const hasWriteChange = this._readURI(uri) !== entireModelCode // a heuristic check
			if (hasWriteChange)
				this._writeText(uri, entireModelCode,
					{ startColumn: 1, startLineNumber: 1, endLineNumber: numLines, endColumn: Number.MAX_SAFE_INTEGER },
					{ shouldRealignDiffAreas: false }
				)
			else {
				// restore all the decorations
				this._refreshStylesAndDiffsInURI(uri)
			}
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

	private _clearAllDiffAreaEffects(diffArea: DiffArea) {
		// clear diffZone effects (diffs)
		if (diffArea.type === 'DiffZone')
			this._deleteDiffs(diffArea)

		diffArea._removeStylesFns.forEach(removeStyles => removeStyles())
		diffArea._removeStylesFns.clear()
	}


	// clears all Diffs (and their styles) and all styles of DiffAreas
	private _clearAllEffects(uri: URI) {
		for (let diffareaid of this.diffAreasOfURI[uri.fsPath]) {
			const diffArea = this.diffAreaOfId[diffareaid]
			this._clearAllDiffAreaEffects(diffArea)
		}
	}


	// delete all diffs, update diffAreaOfId, update diffAreasOfModelId
	private _deleteDiffZone(diffZone: DiffZone) {
		this._clearAllDiffAreaEffects(diffZone)
		delete this.diffAreaOfId[diffZone.diffareaid]
		this.diffAreasOfURI[diffZone._URI.fsPath].delete(diffZone.diffareaid.toString())
	}

	private _deleteCtrlKZone(ctrlKZone: CtrlKZone) {
		this._clearAllEffects(ctrlKZone._URI)
		ctrlKZone._mountInfo?.dispose()
		delete this.diffAreaOfId[ctrlKZone.diffareaid]
		this.diffAreasOfURI[ctrlKZone._URI.fsPath].delete(ctrlKZone.diffareaid.toString())
	}


	private _deleteAllDiffAreas(uri: URI) {
		const diffAreas = this.diffAreasOfURI[uri.fsPath]
		diffAreas.forEach(diffareaid => {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (diffArea.type === 'DiffZone')
				this._deleteDiffZone(diffArea)
			else if (diffArea.type === 'CtrlKZone')
				this._deleteCtrlKZone(diffArea)
		})
	}



	private _diffareaidPool = 0 // each diffarea has an id
	private _addDiffArea<T extends DiffArea>(diffArea: Omit<T, 'diffareaid'>): T {
		const diffareaid = this._diffareaidPool++
		const diffArea2 = { ...diffArea, diffareaid } as T
		this.diffAreasOfURI[diffArea2._URI.fsPath].add(diffareaid.toString())
		this.diffAreaOfId[diffareaid] = diffArea2
		return diffArea2
	}

	private _diffidPool = 0 // each diff has an id
	private _addDiff(computedDiff: ComputedDiff, diffZone: DiffZone): Diff {
		const uri = diffZone._URI
		const diffid = this._diffidPool++

		// create a Diff of it
		const newDiff: Diff = {
			...computedDiff,
			diffid: diffid,
			diffareaid: diffZone.diffareaid,
		}

		const fn = this._addDiffStylesToURI(uri, newDiff)
		diffZone._removeStylesFns.add(fn)

		this.diffOfId[diffid] = newDiff
		diffZone._diffOfId[diffid] = newDiff

		return newDiff
	}




	// changes the start/line locations of all DiffAreas on the page (adjust their start/end based on the change) based on the change that was recently made
	private _realignAllDiffAreasLines(uri: URI, text: string, recentChange: { startLineNumber: number; endLineNumber: number }) {

		// console.log('recent change', recentChange)

		const model = this._getModel(uri)
		if (!model) return

		// compute net number of newlines lines that were added/removed
		const startLine = recentChange.startLineNumber
		const endLine = recentChange.endLineNumber

		const newTextHeight = (text.match(/\n/g) || []).length + 1 // number of newlines is number of \n's + 1, e.g. "ab\ncd"

		// compute overlap with each diffArea and shrink/elongate each diffArea accordingly
		for (const diffareaid of this.diffAreasOfURI[model.uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]

			// if the diffArea is entirely above the range, it is not affected
			if (diffArea.endLine < startLine) {
				// console.log('CHANGE FULLY BELOW DA (doing nothing)')
				continue
			}
			// if a diffArea is entirely below the range, shift the diffArea up/down by the delta amount of newlines
			else if (endLine < diffArea.startLine) {
				// console.log('CHANGE FULLY ABOVE DA')
				const changedRangeHeight = endLine - startLine + 1
				const deltaNewlines = newTextHeight - changedRangeHeight
				diffArea.startLine += deltaNewlines
				diffArea.endLine += deltaNewlines
			}
			// if the diffArea fully contains the change, elongate it by the delta amount of newlines
			else if (startLine >= diffArea.startLine && endLine <= diffArea.endLine) {
				// console.log('DA FULLY CONTAINS CHANGE')
				const changedRangeHeight = endLine - startLine + 1
				const deltaNewlines = newTextHeight - changedRangeHeight
				diffArea.endLine += deltaNewlines
			}
			// if the change fully contains the diffArea, make the diffArea have the same range as the change
			else if (diffArea.startLine > startLine && diffArea.endLine < endLine) {
				// console.log('CHANGE FULLY CONTAINS DA')
				diffArea.startLine = startLine
				diffArea.endLine = startLine + newTextHeight
			}
			// if the change contains only the diffArea's top
			else if (startLine < diffArea.startLine && diffArea.startLine <= endLine) {
				// console.log('CHANGE CONTAINS TOP OF DA ONLY')
				const numOverlappingLines = endLine - diffArea.startLine + 1
				const numRemainingLinesInDA = diffArea.endLine - diffArea.startLine + 1 - numOverlappingLines
				const newHeight = (numRemainingLinesInDA - 1) + (newTextHeight - 1) + 1
				diffArea.startLine = startLine
				diffArea.endLine = startLine + newHeight
			}
			// if the change contains only the diffArea's bottom
			else if (startLine <= diffArea.endLine && diffArea.endLine < endLine) {
				// console.log('CHANGE CONTAINS BOTTOM OF DA ONLY')
				const numOverlappingLines = diffArea.endLine - startLine + 1
				diffArea.endLine += newTextHeight - numOverlappingLines
			}
		}

	}


	private _refreshStylesAndDiffsInURI(uri: URI) {

		// 1. clear DiffArea styles and Diffs
		this._clearAllEffects(uri)

		// 2. style DiffAreas (sweep, etc)
		this._addDiffAreaStylesToURI(uri)

		// 3. add Diffs
		this._computeDiffsAndAddStylesToURI(uri)

		// 4. refresh ctrlK zones
		this._refreshCtrlKInputs(uri)
	}




	// @throttle(100)
	private _writeDiffZoneLLMText(diffZone: DiffZone, llmText: string) {

		// ----------- 1. Write the new code to the document -----------
		// figure out where to highlight based on where the AI is in the stream right now, use the last diff to figure that out
		const uri = diffZone._URI
		const computedDiffs = findDiffs(diffZone.originalCode, llmText)

		// should always be in streaming state here
		if (!diffZone._streamState.isStreaming) {
			console.error('DiffZone was not in streaming state on _writeDiffZoneLLMText')
			return
		}

		// if streaming, use diffs to figure out where to write new code
		// these are two different coordinate systems - new and old line number
		let newCodeEndLine: number // get file[diffArea.startLine...newFileEndLine] with line=newFileEndLine highlighted
		let originalCodeStartLine: number // get original[oldStartingPoint...] (line in the original code, so starts at 1)

		const lastDiff = computedDiffs.pop()

		if (!lastDiff) {
			// console.log('!lastDiff')
			// if the writing is identical so far, display no changes
			originalCodeStartLine = 1
			newCodeEndLine = 1
		}
		else {
			originalCodeStartLine = lastDiff.originalStartLine
			if (lastDiff.type === 'insertion' || lastDiff.type === 'edit')
				newCodeEndLine = lastDiff.endLine
			else if (lastDiff.type === 'deletion')
				newCodeEndLine = lastDiff.startLine
			else
				throw new Error(`Void: diff.type not recognized on: ${lastDiff}`)
		}


		// lines are 1-indexed
		const newCodeTop = llmText.split('\n').slice(0, (newCodeEndLine - 1) + 1).join('\n')
		const oldFileBottom = diffZone.originalCode.split('\n').slice((originalCodeStartLine - 1) + 1, Infinity).join('\n')

		// oriignalCode[1 + line...Infinity]. Must make sure 1 + line < originalCode.length. This is another way to check:
		const newCode = (newCodeTop && oldFileBottom) ? `${newCodeTop}\n${oldFileBottom}` : (oldFileBottom || newCodeTop)

		this._writeText(uri, newCode,
			{ startLineNumber: diffZone.startLine, startColumn: 1, endLineNumber: diffZone.endLine, endColumn: Number.MAX_SAFE_INTEGER, }, // 1-indexed
			{ shouldRealignDiffAreas: true }
		)

		// add diffZone.startLine to convert to right coordinate system (line in file, not in diffarea)
		diffZone._streamState.line = (diffZone.startLine - 1) + newCodeEndLine

		return computedDiffs

	}



	// // if streaming, use diffs to figure out where to write new code
	// 	// these are two different coordinate systems - new and old line number
	// 	let newFileEndLine: number // get new[0...newStoppingPoint] with line=newStoppingPoint highlighted
	// 	let originalCodeStartLine: number // get original[oldStartingPoint...]

	// 	const lastDiff = computedDiffs.pop()

	// 	if (!lastDiff) {
	// 		// if the writing is identical so far, display no changes
	// 		newFileEndLine = diffZone.startLine
	// 		originalCodeStartLine = 1
	// 	}
	// 	else {
	// 		if (lastDiff.type === 'insertion') {
	// 			newFileEndLine = lastDiff.endLine
	// 			originalCodeStartLine = lastDiff.originalStartLine
	// 		}
	// 		else if (lastDiff.type === 'deletion') {
	// 			newFileEndLine = lastDiff.startLine
	// 			originalCodeStartLine = lastDiff.originalStartLine
	// 		}
	// 		else if (lastDiff.type === 'edit') {
	// 			newFileEndLine = lastDiff.endLine
	// 			originalCodeStartLine = lastDiff.originalStartLine
	// 		}
	// 		else {
	// 			throw new Error(`Void: diff.type not recognized on: ${lastDiff}`)
	// 		}
	// 	}

	// 	diffZone._streamState.line = newFileEndLine

	// 	// lines are 1-indexed
	// 	const newFileTop = llmText.split('\n').slice(diffZone.startLine, (newFileEndLine - 1)).join('\n')
	// 	const oldFileBottom = diffZone.originalCode.split('\n').slice((originalCodeStartLine - 1), Infinity).join('\n')

	// 	const newCode = `${newFileTop}\n${oldFileBottom}`

	// 	this._writeText(uri, newCode,
	// 		{ startLineNumber: diffZone.startLine, startColumn: 1, endLineNumber: diffZone.endLine, endColumn: Number.MAX_SAFE_INTEGER, }, // 1-indexed
	// 		{ shouldRealignDiffAreas: true }
	// 	)


	// 	return computedDiffs






	// called first, then call startApplying
	public addCtrlKZone({ startLine, endLine, editor }: AddCtrlKOpts) {

		const uri = editor.getModel()?.uri
		if (!uri) return

		// check if there's overlap with any other ctrlKZone and if so, focus it
		const overlappingCtrlKZone = this._findOverlappingDiffArea({ startLine, endLine, uri, filter: (diffArea) => diffArea.type === 'CtrlKZone' })
		if (overlappingCtrlKZone) {
			(overlappingCtrlKZone as CtrlKZone)._mountInfo?.textAreaRef.current?.focus()
			return
		}

		const overlappingDiffZone = this._findOverlappingDiffArea({ startLine, endLine, uri, filter: (diffArea) => diffArea.type === 'DiffZone' })
		if (overlappingDiffZone)
			return

		const { onFinishEdit } = this._addToHistory(uri)

		const adding: Omit<CtrlKZone, 'diffareaid'> = {
			type: 'CtrlKZone',
			startLine: startLine,
			endLine: endLine,
			editorId: editor.getId(),
			_URI: uri,
			_removeStylesFns: new Set(),
			_mountInfo: null,
		}
		const ctrlKZone = this._addDiffArea(adding)
		this._refreshStylesAndDiffsInURI(uri)

		onFinishEdit()
		return ctrlKZone.diffareaid
	}

	// _remove means delete and also add to history
	public removeCtrlKZone({ diffareaid }: { diffareaid: number }) {
		const ctrlKZone = this.diffAreaOfId[diffareaid]
		if (!ctrlKZone) return
		if (ctrlKZone.type !== 'CtrlKZone') return

		const uri = ctrlKZone._URI
		const { onFinishEdit } = this._addToHistory(uri)
		this._deleteCtrlKZone(ctrlKZone)
		this._refreshStylesAndDiffsInURI(uri)
		onFinishEdit()
	}



	public startApplying(opts: StartApplyingOpts) {
		const addedDiffZone = this._initializeStartApplying(opts)
		return addedDiffZone?.diffareaid
	}




	private _findOverlappingDiffArea({ startLine, endLine, uri, filter }: { startLine: number, endLine: number, uri: URI, filter?: (diffArea: DiffArea) => boolean }): DiffArea | null {
		// check if there's overlap with any other diffAreas and return early if there is
		for (const diffareaid of this.diffAreasOfURI[uri.fsPath]) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (!diffArea) continue
			if (!filter?.(diffArea)) continue
			const noOverlap = diffArea.startLine > endLine || diffArea.endLine < startLine
			if (!noOverlap) {
				return diffArea
			}
		}
		return null
	}


	private _initializeStartApplying(opts: StartApplyingOpts): DiffZone | undefined {

		const { featureName } = opts

		let startLine: number
		let endLine: number
		let uri: URI
		let userMessage: string

		if (featureName === 'Ctrl+L') {

			const uri_ = this._getActiveEditorURI()
			if (!uri_) return
			uri = uri_

			// reject all diffareas on this URI, adding to history (there can't possibly be overlap after this)
			this.removeDiffAreas({ uri, behavior: 'reject' })

			// in ctrl+L the start and end lines are the full document
			const numLines = this._getNumLines(uri)
			if (numLines === null) return
			startLine = 1
			endLine = numLines

			userMessage = opts.userMessage
		}
		else if (featureName === 'Ctrl+K') {
			const { diffareaid } = opts

			const ctrlKZone = this.diffAreaOfId[diffareaid]
			if (ctrlKZone.type !== 'CtrlKZone') return

			const { startLine: startLine_, endLine: endLine_, _URI, _mountInfo } = ctrlKZone
			uri = _URI
			startLine = startLine_
			endLine = endLine_

			if (!_mountInfo?.textAreaRef.current) return
			userMessage = _mountInfo.textAreaRef.current?.value
		}
		else {
			throw new Error(`Void: diff.type not recognized on: ${featureName}`)
		}

		const currentFileStr = this._readURI(uri)
		if (currentFileStr === null) return
		const originalCode = currentFileStr.split('\n').slice((startLine - 1), (endLine - 1) + 1).join('\n')


		let streamRequestIdRef: { current: string | null } = { current: null }


		// add to history
		const { onFinishEdit } = this._addToHistory(uri)


		// __TODO__ ctrl+K should use Ollama's FIM method.
		const ollamaStyleFIM = false
		const modelFimTags = defaultFimTags

		const adding: Omit<DiffZone, 'diffareaid'> = {
			type: 'DiffZone',
			originalCode,
			startLine,
			endLine,
			_URI: uri,
			_streamState: {
				isStreaming: true,
				streamRequestIdRef,
				line: startLine,
			},
			_diffOfId: {}, // added later
			_removeStylesFns: new Set(),
		}
		const diffZone = this._addDiffArea(adding)

		let messages: LLMMessage[]

		if (featureName === 'Ctrl+L') {
			const userContent = ctrlLStream_prompt({ originalCode, userMessage, uri })
			messages = [
				// TODO include more context too
				{ role: 'system', content: ctrlLStream_systemMessage, },
				{ role: 'user', content: userContent, }
			]
		}
		else if (featureName === 'Ctrl+K') {
			const { prefix, suffix } = ctrlKStream_prefixAndSuffix({ fullFileStr: currentFileStr, startLine, endLine })
			const language = filenameToVscodeLanguage(uri.fsPath) ?? ''
			const userContent = ctrlKStream_prompt({ selection: originalCode, userMessage, prefix, suffix, ollamaStyleFIM, fimTags: modelFimTags, language })
			// console.log('PREFIX:\n', prefix)
			// console.log('SUFFIX:\n', suffix)
			// console.log('USER CONTENT:\n', userContent)
			messages = [
				// TODO include more context too (LSP, file history, etc)
				{ role: 'system', content: ctrlKStream_systemMessage, },
				{ role: 'user', content: userContent, }
			]
		}
		else { throw new Error(`featureName ${featureName} is invalid`) }


		const onDone = (hadError: boolean) => {
			diffZone._streamState = { isStreaming: false, }
			if (featureName === 'Ctrl+K') {
				const ctrlKZone = this.diffAreaOfId[opts.diffareaid] as CtrlKZone
				this._deleteCtrlKZone(ctrlKZone)
			}
			this._refreshStylesAndDiffsInURI(uri)
			onFinishEdit()

			// if had error, revert!
			if (hadError) {
				this._undoHistory(diffZone._URI)
			}
		}

		// refresh now in case onText takes a while to get 1st message
		this._refreshStylesAndDiffsInURI(uri)


		const extractText = (fullText: string) => {
			if (featureName === 'Ctrl+K') {
				if (ollamaStyleFIM) return fullText
				return extractCodeFromFIM({ text: fullText, midTag: modelFimTags.midTag })
			}
			else if (featureName === 'Ctrl+L') {
				return extractCodeFromRegular(fullText)
			}
			throw 1
		}

		streamRequestIdRef.current = this._llmMessageService.sendLLMMessage({
			featureName,
			logging: { loggingName: `startApplying - ${featureName}` },
			messages,
			onText: ({ newText, fullText }) => {
				this._writeDiffZoneLLMText(diffZone, extractText(fullText))
				this._refreshStylesAndDiffsInURI(uri)
			},
			onFinalMessage: ({ fullText }) => {
				// console.log('DONE! FULL TEXT\n', extractText(fullText), diffZone.startLine, diffZone.endLine)
				// at the end, re-write whole thing to make sure no sync errors
				this._writeText(uri, extractText(fullText),
					{ startLineNumber: diffZone.startLine, startColumn: 1, endLineNumber: diffZone.endLine, endColumn: Number.MAX_SAFE_INTEGER }, // 1-indexed
					{ shouldRealignDiffAreas: true }
				)
				onDone(false)
			},
			onError: (e) => {
				console.error('Error rewriting file with diff', e);
				const details = errorDetails(e.fullError)
				this._notificationService.notify({
					severity: Severity.Warning,
					message: `Void Error: ${e.message}`,
					source: details ? `(Hold ${isMacintosh ? 'Option' : 'Alt'} to hover) - ${details}` : undefined
				})
				onDone(true)
			},

			range: { startLineNumber: startLine, endLineNumber: endLine, startColumn: 1, endColumn: Number.MAX_SAFE_INTEGER },
		})

		return diffZone

	}


	testDiffs(): DiffZone | undefined {
		const uri = this._getActiveEditorURI()
		if (!uri) return

		const startLine = 1
		const endLine = 4

		const currentFileStr = this._readURI(uri)
		if (currentFileStr === null) return
		const originalCode = currentFileStr.split('\n').slice((startLine - 1), (endLine - 1) + 1).join('\n')

		const { onFinishEdit } = this._addToHistory(uri)
		const adding: Omit<DiffZone, 'diffareaid'> = {
			type: 'DiffZone',
			originalCode,
			startLine,
			endLine,
			_URI: uri,
			_streamState: { isStreaming: false, },
			_diffOfId: {}, // added later
			_removeStylesFns: new Set(),
		}
		const diffZone = this._addDiffArea(adding)
		const endResult = `\
const x = 1;
if (x > 0) {
	console.log('hi!')
}`
		this._writeText(uri, endResult,
			{ startLineNumber: diffZone.startLine, startColumn: 1, endLineNumber: diffZone.endLine, endColumn: Number.MAX_SAFE_INTEGER }, // 1-indexed
			{ shouldRealignDiffAreas: true }
		)
		diffZone._streamState = { isStreaming: false, }
		this._refreshStylesAndDiffsInURI(uri)
		onFinishEdit()

		return diffZone
	}



	private _stopIfStreaming(diffZone: DiffZone) {

		const streamRequestId = diffZone._streamState.streamRequestIdRef?.current
		if (!streamRequestId)
			return

		this._llmMessageService.abort(streamRequestId)

		diffZone._streamState = { isStreaming: false, }

	}

	_undoHistory(uri: URI) {
		this._undoRedoService.undo(uri)
	}

	// call this outside undo/redo (it calls undo). this is only for aborting a diffzone stream
	interruptStreaming(diffareaid: number) {
		const diffArea = this.diffAreaOfId[diffareaid]

		if (!diffArea) return
		if (diffArea.type !== 'DiffZone') return
		if (!diffArea._streamState.isStreaming) return

		this._stopIfStreaming(diffArea)
		this._undoHistory(diffArea._URI)
	}







	// public removeDiffZone(diffZone: DiffZone, behavior: 'reject' | 'accept') {
	// 	const uri = diffZone._URI
	// 	const { onFinishEdit } = this._addToHistory(uri)

	// 	if (behavior === 'reject') this._revertAndDeleteDiffZone(diffZone)
	// 	else if (behavior === 'accept') this._deleteDiffZone(diffZone)

	// 	this._refreshStylesAndDiffsInURI(uri)
	// 	onFinishEdit()
	// }

	private _revertAndDeleteDiffZone(diffZone: DiffZone) {
		const uri = diffZone._URI

		const writeText = diffZone.originalCode
		const toRange: IRange = { startLineNumber: diffZone.startLine, startColumn: 1, endLineNumber: diffZone.endLine, endColumn: Number.MAX_SAFE_INTEGER }
		this._writeText(uri, writeText, toRange, { shouldRealignDiffAreas: true })

		this._deleteDiffZone(diffZone)
	}


	// remove a batch of diffareas all at once (and handle accept/reject of their diffs)
	public removeDiffAreas({ uri, behavior }: { uri: URI, behavior: 'reject' | 'accept' }) {

		const diffareaids = this.diffAreasOfURI[uri.fsPath]
		if (diffareaids.size === 0) return // do nothing

		const { onFinishEdit } = this._addToHistory(uri)

		for (const diffareaid of diffareaids) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (!diffArea) continue

			if (diffArea.type == 'DiffZone') {
				if (behavior === 'reject') this._revertAndDeleteDiffZone(diffArea)
				else if (behavior === 'accept') this._deleteDiffZone(diffArea)
			}
			else if (diffArea.type === 'CtrlKZone') {
				this._deleteCtrlKZone(diffArea)
			}
		}

		this._refreshStylesAndDiffsInURI(uri)
		onFinishEdit()
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
			this._deleteDiffZone(diffArea)
		}

		this._refreshStylesAndDiffsInURI(uri)

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
			// console.log('REJECTING:', diff)
			// handle the case where the insertion was a newline at end of diffarea (applying to the next line doesnt work because it doesnt exist, vscode just doesnt delete the correct # of newlines)
			if (diff.endLine === diffArea.endLine) {
				// delete the line before instead of after
				writeText = ''
				toRange = { startLineNumber: diff.startLine - 1, startColumn: Number.MAX_SAFE_INTEGER, endLineNumber: diff.endLine, endColumn: 1 } // 1-indexed
			}
			else {
				writeText = ''
				toRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.endLine + 1, endColumn: 1 } // 1-indexed
			}

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

		// update the file
		this._writeText(uri, writeText, toRange, { shouldRealignDiffAreas: true })

		// originalCode does not change!

		// delete the diff
		this._deleteDiff(diff)

		// diffArea should be removed if it has no more diffs in it
		if (Object.keys(diffArea._diffOfId).length === 0) {
			this._deleteDiffZone(diffArea)
		}

		this._refreshStylesAndDiffsInURI(uri)

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
			const layoutInfo = editor.getLayoutInfo();
			const minimapWidth = layoutInfo.minimap.minimapWidth;
			const verticalScrollbarWidth = layoutInfo.verticalScrollbarWidth;
			const buttonWidth = this._domNode.offsetWidth;

			const leftPx = layoutInfo.width - minimapWidth - verticalScrollbarWidth - buttonWidth;
			this._domNode.style.left = `${leftPx}px`;
		}

		// Mount first, then update positions
		editor.addOverlayWidget(this);


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




registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'void.testDiff',
			title: localize2('voidTestDiff', 'Void Test Diff'),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const inlineDiffsService = accessor.get(IInlineDiffsService)
		inlineDiffsService.testDiffs()

	}
})
