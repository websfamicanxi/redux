
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor, IViewZone } from '../../../../editor/browser/editorBrowser.js';

import { IUndoRedoElement, IUndoRedoService, UndoRedoElementType, UndoRedoGroup } from '../../../../platform/undoRedo/common/undoRedo.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { sendLLMMessage } from './react/out/util/sendLLMMessage.js';
import { throttle } from '../../../../base/common/decorators.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { IVoidConfigStateService } from './registerConfig.js';
import { writeFileWithDiffInstructions } from './prompt/systemPrompts.js';
import { findDiffs } from './findDiffs.js';
import { EndOfLinePreference, IModelDeltaDecoration, ITextModel } from '../../../../editor/common/model.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';



// read files from VSCode
export const VSReadFile = async (fileService: IFileService, uri: URI): Promise<string | null> => {
	try {
		const fileObj = await fileService.readFile(uri)
		const content = fileObj.value.toString()
		return content
	} catch (error) {
		console.error(`VSReadFile (Void) - Failed to read URI`, uri, error);
		return null
	}
}


export type Diff = {
	diffid: number,
	diffareaid: number, // the diff area this diff belongs to, "computed"
	type: 'edit' | 'insertion' | 'deletion';
	originalCode: string;

	startLine: number;
	endLine: number;
	originalStartLine: number;
	originalEndLine: number;

	startCol: number;
	endCol: number;

	disposeStyles: (() => void) | null;

	// _zone: IViewZone | null,
	// _decorationId: string | null,
}



// _ means computed later, temporary, or part of current state
type DiffArea = {
	diffareaid: number,
	originalStartLine: number,
	originalEndLine: number,
	startLine: number,
	endLine: number,

	_diffs: Diff[],
	_model: ITextModel, // the model or "document" this diffarea lives on
	_generationid: number,
	_sweepLine: number | null,
	_sweepCol: number | null,
}




type HistorySnapshot = {
	diffAreaOfId: Record<string, DiffArea>,
} &
	({
		type: 'ctrl+k',
		ctrlKText: string
	} | {
		type: 'ctrl+l',
	})


type StreamingState = {
	type: 'streaming';
	// editGroup: UndoRedoGroup; // all changes made by us when streaming should be a part of the group so we can undo them all together
} | {
	type: 'idle';
}


export interface IInlineDiffsService {
	readonly _serviceBrand: undefined;
	startStreaming(type: 'ctrl+k' | 'ctrl+l', userMessage: string): void;

}

export const IInlineDiffsService = createDecorator<IInlineDiffsService>('inlineDiffsService');

class InlineDiffsService extends Disposable implements IInlineDiffsService {
	_serviceBrand: undefined;

	/*
	Picture of all the data structures:
	() -modelid-> {originalFileStr, Set(diffareaid), state}
		   ^  				     	|
			\________________   diffareaid -> diffarea -> diff[]
													^		|
													  \____ diff
	*/

	// state of each document
	originalFileStrOfModelId: Record<string, string> = {} // modelid -> originalFile
	diffAreasOfModelId: Record<string, Set<string>> = {} // modelid -> Set(diffAreaId)
	streamingStateOfModelId: Record<string, StreamingState> = {} // modelid -> state

	diffAreaOfId: Record<string, DiffArea> = {};
	diffOfId: Record<string, Diff> = {}; // redundant with diffArea._diffs

	_generationidPool = 0 // diffs that were generated together all get the same id (not sure if we'll use this or not but keeping it)
	_diffareaidPool = 0 // each diffarea has an id
	_diffidPool = 0 // each diff has an id

	constructor(
		// @IHistoryService private readonly _historyService: IHistoryService, // history service is the history of pressing alt left/right
		@IVoidConfigStateService private readonly _voidConfigStateService: IVoidConfigStateService,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService, // undoRedo service is the history of pressing ctrl+z
		@IFileService private readonly _fileService: IFileService,

	) {
		super();

	}



	private _addInlineDiffZone = (model: ITextModel, originalText: string, greenRange: IRange) => {

		const _addInlineDiffZoneToEditor = (editor: ICodeEditor) => {
			// green decoration and gutter decoration
			const greenDecoration: IModelDeltaDecoration[] = [{
				range: greenRange,
				options: {
					className: 'line-insert', // .monaco-editor .line-insert
					description: 'line-insert',
					isWholeLine: true,
					minimap: {
						color: { id: 'minimapGutter.addedBackground' },
						position: 2
					},
					overviewRuler: {
						color: { id: 'editorOverviewRuler.addedForeground' },
						position: 7
					}
				}
			}];
			const decorationIds = editor.deltaDecorations([], greenDecoration)


			// red in a view zone
			let zoneId: string | null = null
			editor.changeViewZones(accessor => {
				// Get the editor's font info
				const fontInfo = editor.getOption(EditorOption.fontInfo);

				const domNode = document.createElement('div');
				domNode.className = 'monaco-editor view-zones line-delete monaco-mouse-cursor-text';
				domNode.style.fontSize = `${fontInfo.fontSize}px`;
				domNode.style.fontFamily = fontInfo.fontFamily;
				domNode.style.lineHeight = `${fontInfo.lineHeight}px`;

				// div
				const lineContent = document.createElement('div');
				lineContent.className = 'view-line'; // .monaco-editor .inline-deleted-text

				// span
				const contentSpan = document.createElement('span');

				// span
				const codeSpan = document.createElement('span');
				codeSpan.className = 'mtk1'; // char-delete
				codeSpan.textContent = originalText;

				// Mount
				contentSpan.appendChild(codeSpan);
				lineContent.appendChild(contentSpan);
				domNode.appendChild(lineContent);

				// Gutter (thing to the left)
				const gutterDiv = document.createElement('div');
				gutterDiv.className = 'inline-diff-gutter';
				const minusDiv = document.createElement('div');
				minusDiv.className = 'inline-diff-deleted-gutter';
				// minusDiv.textContent = '-';
				gutterDiv.appendChild(minusDiv);

				const viewZone: IViewZone = {
					afterLineNumber: greenRange.startLineNumber - 1,
					heightInLines: originalText.split('\n').length + 1,
					domNode: domNode,
					suppressMouseDown: true,
					marginDomNode: gutterDiv
				};

				zoneId = accessor.addZone(viewZone);
				// editor.layout();
				// this._diffZones.set(editor, [zoneId]);
			});


			const dispose = () => {
				editor.deltaDecorations(decorationIds, []);
				editor.changeViewZones(accessor => {
					if (zoneId) accessor.removeZone(zoneId);
				});
			}
			return dispose
		}

		const editors = this._editorService.listCodeEditors().filter(editor => editor.getModel()?.id === model.id)

		const disposeFns = editors.map(editor => _addInlineDiffZoneToEditor(editor))
		const dispose = () => {
			disposeFns.forEach(fn => fn())
		}

		return dispose
	}










	private _addToHistory(model: ITextModel) {

		const uri = model.uri

		const beforeSnapshot: HistorySnapshot = {
			diffAreaOfId: structuredClone(this.diffAreaOfId),
			type: 'ctrl+l',
		}

		let afterSnapshot: HistorySnapshot | null = null

		const elt: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: uri,
			label: 'Add Diffs',
			code: 'undoredo.inlineDiffs',
			// called when undoing this state
			undo: () => {
				// when the user undoes this element, revert to oldSnapshot
				this.diffAreaOfId = structuredClone(beforeSnapshot.diffAreaOfId)
				this._refreshAllDiffsAndStyles(model)
				this._refreshSweepStyles(model)
			},
			// called when restoring this state
			redo: () => {
				if (afterSnapshot === null) return
				this.diffAreaOfId = structuredClone(afterSnapshot.diffAreaOfId)
				this._refreshAllDiffsAndStyles(model)
				this._refreshSweepStyles(model)
			}
		}
		const editGroup = new UndoRedoGroup()
		this._undoRedoService.pushElement(elt, editGroup)


		const onFinishEdit = () => () => {
			if (afterSnapshot !== null) return
			afterSnapshot = {
				diffAreaOfId: structuredClone(this.diffAreaOfId),
				type: 'ctrl+l',
			}
		}
		return { onFinishEdit, editGroup }
	}




	private _deleteDiffs(diffArea: DiffArea) {
		for (const diff of diffArea._diffs) {
			diff.disposeStyles?.()
			delete this.diffOfId[diff.diffid]
		}
		diffArea._diffs = []
	}

	private _deleteDiffArea(diffArea: DiffArea) {
		this._deleteDiffs(diffArea)
		delete this.diffAreaOfId[diffArea.diffareaid]
		this.diffAreasOfModelId[diffArea._model.id].delete(diffArea.diffareaid.toString())
	}





	// for every diffarea in this document, recompute its diffs and restyle it (the two are coupled)
	private _refreshAllDiffsAndStyles(model: ITextModel) {

		const modelid = model.id

		const originalFile = this.originalFileStrOfModelId[modelid]
		if (originalFile === undefined) return

		// ------------ recompute all diffs in each diffarea ------------
		// for each diffArea
		for (const diffareaid of this.diffAreasOfModelId[modelid] || new Set()) {

			const diffArea = this.diffAreaOfId[diffareaid]

			// clear its diffs
			this._deleteDiffs(diffArea)

			// recompute diffs:
			const originalCode = originalFile.split('\n').slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')
			const currentCode = model.getValue(EndOfLinePreference.LF).split('\n').slice(diffArea.startLine, diffArea.endLine + 1).join('\n')

			const computedDiffs = findDiffs(originalCode, currentCode)


			for (let computedDiff of computedDiffs) {
				// add the view zone
				const greenRange: IRange = { startLineNumber: diffArea.startLine, startColumn: 0, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, }
				const dispose = this._addInlineDiffZone(model, computedDiff.originalCode, greenRange)

				// create a Diff of it
				const diffid = this._diffidPool++
				const newDiff: Diff = {
					diffid: diffid,
					diffareaid: diffArea.diffareaid,
					disposeStyles: dispose,
					...computedDiff,
				}

				this.diffOfId[diffid] = newDiff
				diffArea._diffs.push(newDiff)
			}
		}
	}

	private _refreshSweepStyles(model: ITextModel) {
		const modelid = model.id;

		// Create decorations for each diffArea
		for (const diffareaid of this.diffAreasOfModelId[modelid] || new Set()) {
			const diffArea = this.diffAreaOfId[diffareaid];
			if (!diffArea._sweepLine) continue;

			const lightGrayDecoration: IModelDeltaDecoration[] = [{
				range: {
					startLineNumber: diffArea._sweepLine + 1,
					startColumn: 0,
					endLineNumber: diffArea.endLine,
					endColumn: Number.MAX_SAFE_INTEGER
				},
				options: {
					className: 'sweep-light-gray',
					description: 'sweep-light-gray',
					isWholeLine: true
				}
			}];

			const darkGrayDecoration: IModelDeltaDecoration[] = [{
				range: {
					startLineNumber: diffArea._sweepLine,
					startColumn: 0,
					endLineNumber: diffArea._sweepLine,
					endColumn: Number.MAX_SAFE_INTEGER
				},
				options: {
					className: 'sweep-dark-gray',
					description: 'sweep-dark-gray',
					isWholeLine: true
				}
			}];

			model.deltaDecorations([], [...lightGrayDecoration, ...darkGrayDecoration]);
		}
	}


	// changes the start/line locations based on the changes that were recently made. does not change any of the diffs in the diff areas
	// changes tells us how many lines were inserted/deleted so we can grow/shrink the diffAreas accordingly
	private _resizeOnTextChange(modelid: string, changes: { text: string, startLine: number, endLine: number }[], changesTo: 'originalFile' | 'currentFile') {

		// resize all diffareas on page (adjust their start/end based on the change)

		let endLine: 'originalEndLine' | 'endLine'
		let startLine: 'originalStartLine' | 'startLine'

		if (changesTo === 'originalFile') {
			endLine = 'originalEndLine' as const
			startLine = 'originalStartLine' as const
		} else {
			endLine = 'endLine' as const
			startLine = 'startLine' as const
		}

		// here, `change.range` is the range of the original file that gets replaced with `change.text`
		for (const change of changes) {

			// compute net number of newlines lines that were added/removed
			const numNewLines = (change.text.match(/\n/g) || []).length
			const numLineDeletions = change.endLine - change.startLine
			const deltaNewlines = numNewLines - numLineDeletions

			// compute overlap with each diffArea and shrink/elongate each diffArea accordingly
			for (const diffareaid of this.diffAreasOfModelId[modelid] || []) {
				const diffArea = this.diffAreaOfId[diffareaid]

				// if the change is fully within the diffArea, elongate it by the delta amount of newlines
				if (change.startLine >= diffArea[startLine] && change.endLine <= diffArea[endLine]) {
					diffArea[endLine] += deltaNewlines
				}
				// check if the `diffArea` was fully deleted and remove it if so
				if (diffArea[startLine] > diffArea[endLine]) {
					this.diffAreasOfModelId[modelid].delete(diffareaid)
					continue
				}

				// if a diffArea is below the last character of the change, shift the diffArea up/down by the delta amount of newlines
				if (diffArea[startLine] > change.endLine) {
					diffArea[startLine] += deltaNewlines
					diffArea[endLine] += deltaNewlines
				}

				// TODO handle other cases where eg. the change overlaps many diffAreas
			}
			// TODO merge any diffAreas if they overlap with each other as a result from the shift

		}
	}




	private _registeredListeners = new Set<string>() // set of model IDs
	private _registerTextChangeListener(model: ITextModel) {
		const modelid = model.id

		if (this._registeredListeners.has(modelid)) return

		this._registeredListeners.add(modelid)
		// listen for text changes
		this._register(
			model.onDidChangeContent(e => {
				const changes = e.changes.map(c => ({ startLine: c.range.startLineNumber, endLine: c.range.endLineNumber, text: c.text, }))
				this._resizeOnTextChange(modelid, changes, 'currentFile')
				this._refreshAllDiffsAndStyles(model)
			})
		)

		this._register(
			model.onWillDispose(e => {
				this._registeredListeners.delete(modelid)
			})
		)
	}



	private _writeToModel(model: ITextModel, text: string, range: IRange, editorGroup: UndoRedoGroup) {
		if (!model.isDisposed())
			model.pushEditOperations(null, [{ range, text }], () => null, editorGroup)
	}



	@throttle(100)
	private async _updateDiffAreaText(diffArea: DiffArea, llmCodeSoFar: string, editorGroup: UndoRedoGroup) {
		// clear all diffs in this diffarea and recompute them
		const modelid = diffArea._model.id

		if (this.streamingStateOfModelId[modelid].type !== 'streaming')
			return

		// original code all diffs are based on
		const originalDiffAreaCode = (this.originalFileStrOfModelId[modelid] || '').split('\n').slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')

		// figure out where to highlight based on where the AI is in the stream right now, use the last diff in findDiffs to figure that out
		const diffs = findDiffs(originalDiffAreaCode, llmCodeSoFar)
		const lastDiff = diffs?.[diffs.length - 1] ?? null

		// these are two different coordinate systems - new and old line number
		let newFileEndLine: number // get new[0...newStoppingPoint] with line=newStoppingPoint highlighted
		let oldFileStartLine: number // get original[oldStartingPoint...]

		if (!lastDiff) {
			// if the writing is identical so far, display no changes
			newFileEndLine = 0
			oldFileStartLine = 0
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
				throw new Error(`updateStream: diff.type not recognized: ${lastDiff.type}`)
			}
		}

		// display
		const newFileTop = llmCodeSoFar.split('\n').slice(0, newFileEndLine + 1).join('\n')
		const oldFileBottom = originalDiffAreaCode.split('\n').slice(oldFileStartLine + 1, Infinity).join('\n')

		let newCode = `${newFileTop}\n${oldFileBottom}`
		diffArea._sweepLine = newFileEndLine


		// applies edits without adding them to undo/redo stack
		// model.applyEdits([{
		// 	range: { startLineNumber: diffArea.startLine, startColumn: 0, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, },
		// 	text: newCode
		// }])
		// this._bulkEditService.apply([new ResourceTextEdit(model.uri, {
		// 	range: { startLineNumber: diffArea.startLine, startColumn: 0, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, },
		// 	text: newCode
		// })], { undoRedoGroupId: editorGroup.id }); // count all changes towards the group
		const model = diffArea._model
		this._writeToModel(
			model,
			newCode,
			{ startLineNumber: diffArea.startLine, startColumn: 0, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, },
			editorGroup
		)



		// TODO resize diffAreas?? Or is this handled already by the listener?
	}




	private async _initializeStream(model: ITextModel, diffRepr: string) {


		const uri = model.uri
		const modelid = uri.toString()
		console.log('Model URI:', modelid)

		const originalFileStr = await VSReadFile(this._fileService, uri)
		if (originalFileStr === null) return

		// diff area begin and end line
		const beginLine = 0
		const endLine = model.getLineCount()

		// check if there's overlap with any other diffAreas and return early if there is
		for (let diffareaid of this.diffAreasOfModelId[modelid]) {
			const da2 = this.diffAreaOfId[diffareaid]
			if (!da2) continue
			const noOverlap = da2.startLine > endLine || da2.endLine < beginLine
			if (!noOverlap) {
				console.error('Not diffing because found overlap:', this.diffAreasOfModelId[modelid], beginLine, endLine)
				return
			}
		}

		// start listening for text changes
		this._registerTextChangeListener(model)

		// add to history
		const { onFinishEdit, editGroup } = this._addToHistory(model)

		// create a diffArea for the stream
		const diffareaid = this._diffareaidPool++
		const generationid = this._generationidPool++

		// in ctrl+L the start and end lines are the full document
		const diffArea: DiffArea = {
			diffareaid: diffareaid,
			originalStartLine: beginLine,
			originalEndLine: endLine,
			startLine: beginLine,
			endLine: endLine, // starts out the same as the current file
			_model: model,
			_sweepLine: null,
			_sweepCol: null,
			_generationid: generationid,
			_diffs: [], // added later
		}

		this.originalFileStrOfModelId[modelid] = originalFileStr

		// make sure array is defined
		if (!(modelid in this.diffAreasOfModelId))
			this.diffAreasOfModelId[modelid] = new Set()


		// add `diffArea` to storage
		this.diffAreasOfModelId[modelid].add(diffArea.diffareaid.toString())

		// actually call the LLM
		const voidConfig = this._voidConfigStateService.state
		const promptContent = `\
ORIGINAL_FILE
\`\`\`
${originalFileStr}
\`\`\`

DIFF
\`\`\`
${diffRepr}
\`\`\`

INSTRUCTIONS
Please finish writing the new file by applying the diff to the original file. Return ONLY the completion of the file, without any explanation.
`
		await new Promise<void>((resolve, reject) => {
			sendLLMMessage({
				logging: { loggingName: 'streamChunk' },
				messages: [
					{ role: 'system', content: writeFileWithDiffInstructions, },
					// TODO include more context too
					{ role: 'user', content: promptContent, }
				],
				onText: (newText: string, fullText: string) => {
					this._updateDiffAreaText(diffArea, fullText, editGroup)
					this._refreshAllDiffsAndStyles(model)
					this._refreshSweepStyles(model)
				},
				onFinalMessage: (fullText: string) => {
					this._updateDiffAreaText(diffArea, fullText, editGroup)
					this._refreshAllDiffsAndStyles(model)
					this._refreshSweepStyles(model)
					resolve();
				},
				onError: (e: any) => {
					console.error('Error rewriting file with diff', e);
					resolve();
				},
				voidConfig,
				abortRef: { current: null },
			})
		})
		onFinishEdit()

	}






	startStreaming(type: 'ctrl+k' | 'ctrl+l', userMessage: string) {

		const editor = this._editorService.getActiveCodeEditor()
		if (!editor) return

		const model = editor.getModel()
		if (!model) return

		// update streaming state
		const streamingState: StreamingState = { type: 'streaming' }
		this.streamingStateOfModelId[model.id] = streamingState

		// initialize stream
		this._initializeStream(model, userMessage)

	}


	interruptStreaming() {
		// TODO add abort
	}











	// called on void.acceptDiff
	public async acceptDiff({ diffid }: { diffid: number }) {

		const diff = this.diffOfId[diffid]
		if (!diff) return

		const { diffareaid } = diff
		const diffArea = this.diffAreaOfId[diffareaid]
		if (!diffArea) return

		const model = diffArea._model
		const { id: modelid, uri } = model

		const originalFile = this.originalFileStrOfModelId[modelid]
		const currentFile = await VSReadFile(this._fileService, uri)
		if (currentFile === null) return

		// add to history
		const { onFinishEdit, editGroup: _editGroup } = this._addToHistory(model)

		// Fixed: Handle newlines properly by splitting into lines and joining with proper newlines
		const originalLines = originalFile.split('\n');
		const currentLines = currentFile.split('\n');

		// Get the changed lines from current file
		const changedLines = currentLines.slice(diff.startLine, diff.endLine + 1);

		// Create new original file content by replacing the affected lines
		const newOriginalLines = [
			...originalLines.slice(0, diff.originalStartLine),
			...changedLines,
			...originalLines.slice(diff.originalEndLine + 1)
		];

		this.originalFileStrOfModelId[modelid] = newOriginalLines.join('\n');

		// // Update diff areas based on the change (this) - not sure why this is needed, accepting means there was no change
		// this.resizeDiffAreas(modelid, [{
		// 	text: changedLines.join('\n'),
		// 	startLine: diff.originalRange.start.line,
		// 	endLine: diff.originalRange.end.line
		// }], 'originalFile')

		// diffArea should be removed if the new original lines (the new accepted lines) are exactly the same as the current lines
		const currentArea = currentLines.slice(diffArea.startLine, diffArea.endLine + 1).join('\n')
		const originalArea = newOriginalLines.slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')
		const shouldDeleteDiffArea = originalArea === currentArea
		if (shouldDeleteDiffArea) {
			this._deleteDiffArea(diffArea)
			this._refreshAllDiffsAndStyles(model)
		}

		onFinishEdit()

	}




	// called on void.rejectDiff
	public async rejectDiff({ diffid }: { diffid: number }) {

		const diff = this.diffOfId[diffid]
		if (!diff) return

		const { diffareaid } = diff
		const diffArea = this.diffAreaOfId[diffareaid]
		if (!diffArea) return

		const model = diffArea._model
		const { id: modelid, uri } = model

		const originalFile = this.originalFileStrOfModelId[modelid]
		const currentFile = await VSReadFile(this._fileService, uri)
		if (currentFile === null) return


		// add to history
		const { onFinishEdit, editGroup } = this._addToHistory(model)

		// Apply the rejection by replacing with original code (without putting it on the undo/redo stack, this is OK because we put it on the stack ourselves)
		this._writeToModel(
			model,
			diff.originalCode,
			{ startLineNumber: diffArea.startLine, startColumn: 0, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, },
			editGroup
		)

		// Check if diffArea should be removed
		const currentLines = currentFile.split('\n');
		const originalLines = originalFile.split('\n');

		const currentArea = currentLines.slice(diffArea.startLine, diffArea.endLine + 1).join('\n')
		const originalArea = originalLines.slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')
		const shouldDeleteDiffArea = originalArea === currentArea
		if (shouldDeleteDiffArea) {
			this._deleteDiffArea(diffArea)
		}
		const editor = this._editorService.getActiveCodeEditor()
		if (editor?.getModel()?.id === modelid)
			this._refreshAllDiffsAndStyles(model)

		onFinishEdit()

	}

}

registerSingleton(IInlineDiffsService, InlineDiffsService, InstantiationType.Eager);







