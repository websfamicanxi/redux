
import * as vscode from 'vscode';
// import { diffLines, Change } from 'diff';
import { DiffBlock } from './shared_types';

import { diff_match_patch } from 'diff-match-patch';


const diffLines = (text1: string, text2: string) => {
	var dmp = new diff_match_patch();
	var a = dmp.diff_linesToChars_(text1, text2);
	var lineText1 = a.chars1;
	var lineText2 = a.chars2;
	var lineArray = a.lineArray;
	var diffs = dmp.diff_main(lineText1, lineText2, false);
	dmp.diff_charsToLines_(diffs, lineArray);
	// dmp.diff_cleanupSemantic(diffs);
	return diffs;
}


// TODO use a better diff algorithm
export const findDiffs = (oldText: string, newText: string): DiffBlock[] => {

	const diffs = diffLines(oldText, newText);

	const blocks: DiffBlock[] = [];
	let reprBlock: string[] = [];
	let deletedBlock: string[] = [];
	let insertedBlock: string[] = [];
	let insertedLine = 0;
	let deletedLine = 0;
	let insertedStart = 0;
	let deletedStart = 0;

	diffs.forEach(([operation, text]) => {

		const lines = text.split('\n');

		switch (operation) {

			// insertion
			case 1:
				if (reprBlock.length === 0) { reprBlock.push('@@@@'); }
				if (insertedBlock.length === 0) insertedStart = insertedLine;
				insertedLine += lines.length - 1; // Update only the line count for new text
				insertedBlock.push(text);
				reprBlock.push(lines.map(line => `+ ${line}`).join('\n'));
				break;

			// deletion
			case -1:
				if (reprBlock.length === 0) { reprBlock.push('@@@@'); }
				if (deletedBlock.length === 0) deletedStart = deletedLine;
				deletedLine += lines.length - 1; // Update only the line count for old text
				deletedBlock.push(text);
				reprBlock.push(lines.map(line => `- ${line}`).join('\n'));
				break;

			// no change
			case 0:
				// If we have a pending block, add it to the blocks array
				if (insertedBlock.length > 0 || deletedBlock.length > 0) {
					blocks.push({
						code: reprBlock.join(''),
						deletedCode: deletedBlock.join(''),
						insertedCode: insertedBlock.join(''),
						deletedRange: new vscode.Range(deletedStart, 0, deletedLine, Number.MAX_SAFE_INTEGER),
						insertedRange: new vscode.Range(insertedStart, 0, insertedLine, Number.MAX_SAFE_INTEGER),
					});
				}

				// Reset the block variables
				reprBlock = [];
				deletedBlock = [];
				insertedBlock = [];

				// Update line counts for unchanged text
				insertedLine += lines.length - 1;
				deletedLine += lines.length - 1;

				break;
		}
	});

	// Add any remaining blocks after the loop ends
	if (insertedBlock.length > 0 || deletedBlock.length > 0) {
		blocks.push({
			code: reprBlock.join('\n'),
			deletedCode: deletedBlock.join('\n'),
			insertedCode: insertedBlock.join('\n'),
			deletedRange: new vscode.Range(deletedStart, 0, deletedLine, Number.MAX_SAFE_INTEGER),
			insertedRange: new vscode.Range(insertedStart, 0, insertedLine, Number.MAX_SAFE_INTEGER),
		});
	}

	return blocks;
};



// export const findDiffs = (oldText: string, newText: string): DiffBlock[] => {

// 	const diffs = diffLines(oldText, newText);

// 	const blocks: DiffBlock[] = [];

// 	let reprBlock: string[] = [];
// 	let deletedBlock: string[] = [];
// 	let insertedBlock: string[] = [];

// 	let insertedEnd = 0;
// 	let deletedEnd = 0;
// 	let insertedStart = 0;
// 	let deletedStart = 0;

// 	diffs.forEach(part => {

// 		part.count = part.count ?? 0

// 		// if the part is an addition or deletion, add it to the current block
// 		if (part.added || part.removed) {
// 			if (reprBlock.length === 0) { reprBlock.push('@@@@'); }
// 			if (part.added) {
// 				if (insertedBlock.length === 0) insertedStart = insertedEnd;
// 				insertedEnd += part.count
// 				insertedBlock.push(part.value);
// 				reprBlock.push(part.value.split('\n').map(line => `+ ${line}`).join('\n'));
// 			}
// 			if (part.removed) {
// 				if (deletedBlock.length === 0) deletedStart = deletedEnd;
// 				deletedEnd += part.count
// 				deletedBlock.push(part.value);
// 				reprBlock.push(part.value.split('\n').map(line => `- ${line}`).join('\n'));
// 			}
// 		}

// 		// if the part is unchanged, finalize the block and add it to the array
// 		else {
// 			// if the block is not null, add it to the array
// 			if (insertedBlock.length > 0 || deletedBlock.length > 0) {
// 				blocks.push({
// 					code: reprBlock.join('\n'),
// 					deletedCode: deletedBlock.join(''),
// 					insertedCode: insertedBlock.join(''),
// 					deletedRange: new vscode.Range(deletedStart, 0, deletedEnd, Number.MAX_SAFE_INTEGER),
// 					insertedRange: new vscode.Range(insertedStart, 0, insertedEnd, Number.MAX_SAFE_INTEGER),
// 				});
// 			}

// 			// update block variables
// 			reprBlock = [];
// 			deletedBlock = [];
// 			insertedBlock = [];
// 			insertedEnd += part.count;
// 			deletedEnd += part.count;

// 		}

// 	})

// 	// finally, add the last block to the array
// 	if (insertedBlock.length > 0 || deletedBlock.length > 0) {
// 		blocks.push({
// 			code: reprBlock.join('\n'),
// 			deletedCode: deletedBlock.join(''),
// 			insertedCode: insertedBlock.join(''),
// 			deletedRange: new vscode.Range(deletedStart, 0, deletedEnd, Number.MAX_SAFE_INTEGER),
// 			insertedRange: new vscode.Range(insertedStart, 0, insertedEnd, Number.MAX_SAFE_INTEGER),
// 		});
// 	}

// 	return blocks;

// }

