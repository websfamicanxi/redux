/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ITerminalService, ITerminalInstance, ICreateTerminalOptions } from '../../../../workbench/contrib/terminal/browser/terminal.js';
import { MAX_TERMINAL_BG_COMMAND_TIME, MAX_TERMINAL_CHARS, MAX_TERMINAL_INACTIVE_TIME } from '../common/prompt/prompts.js';
import { TerminalResolveReason } from '../common/toolsServiceTypes.js';



export interface ITerminalToolService {
	readonly _serviceBrand: undefined;

	listPersistentTerminalIds(): string[];
	runCommand(command: string, opts: { type: 'persistent', persistentTerminalId: string } | { type: 'ephemeral', cwd: string | null, terminalId: string }): Promise<{ interrupt: () => void; resPromise: Promise<{ result: string, resolveReason: TerminalResolveReason }> }>;
	focusPersistentTerminal(terminalId: string): Promise<void>
	persistentTerminalExists(terminalId: string): boolean

	createPersistentTerminal(opts: { cwd: string | null }): Promise<string>
	killPersistentTerminal(terminalId: string): Promise<void>

	getPersistentTerminal(terminalId: string): ITerminalInstance | undefined
	getTemporaryTerminal(terminalId: string): ITerminalInstance | undefined
}

export const ITerminalToolService = createDecorator<ITerminalToolService>('TerminalToolService');



function isCommandComplete(output: string) {
	// https://code.visualstudio.com/docs/terminal/shell-integration#_vs-code-custom-sequences-osc-633-st
	const completionMatch = output.match(/\]633;D(?:;(\d+))?/)
	if (!completionMatch) { return false }
	if (completionMatch[1] !== undefined) return { exitCode: parseInt(completionMatch[1]) }
	return { exitCode: 0 }
}


export const persistentTerminalNameOfId = (id: string) => {
	if (id === '1') return 'Void Agent'
	return `Void Agent (${id})`
}
export const idOfPersistentTerminalName = (name: string) => {
	if (name === 'Void Agent') return '1'

	const match = name.match(/Void Agent \((\d+)\)/)
	if (!match) return null
	if (Number.isInteger(match[1]) && Number(match[1]) >= 1) return match[1]
	return null
}

export class TerminalToolService extends Disposable implements ITerminalToolService {
	readonly _serviceBrand: undefined;

	private persistentTerminalInstanceOfId: Record<string, ITerminalInstance> = {}
	private temporaryTerminalInstanceOfId: Record<string, ITerminalInstance> = {}

	constructor(
		@ITerminalService private readonly terminalService: ITerminalService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super();

		// runs on ALL terminals for simplicity
		const initializeTerminal = (terminal: ITerminalInstance) => {
			// when exit, remove
			const d = terminal.onExit(() => {
				const terminalId = idOfPersistentTerminalName(terminal.title)
				if (terminalId !== null && (terminalId in this.persistentTerminalInstanceOfId)) delete this.persistentTerminalInstanceOfId[terminalId]
				d.dispose()
			})
		}


		// initialize any terminals that are already open
		for (const terminal of terminalService.instances) {
			const proposedTerminalId = idOfPersistentTerminalName(terminal.title)
			if (proposedTerminalId) this.persistentTerminalInstanceOfId[proposedTerminalId] = terminal

			initializeTerminal(terminal)
		}

		this._register(
			terminalService.onDidCreateInstance(terminal => { initializeTerminal(terminal) })
		)

	}


	listPersistentTerminalIds() {
		return Object.keys(this.persistentTerminalInstanceOfId)
	}

	getValidNewTerminalId(): string {
		// {1 2 3} # size 3, new=4
		// {1 3 4} # size 3, new=2
		// 1 <= newTerminalId <= n + 1
		const n = Object.keys(this.persistentTerminalInstanceOfId).length;
		if (n === 0) return '1'

		for (let i = 1; i <= n + 1; i++) {
			const potentialId = i + '';
			if (!(potentialId in this.persistentTerminalInstanceOfId)) return potentialId;
		}
		throw new Error('This should never be reached by pigeonhole principle');
	}


	private async _createTerminal(props: { cwd: string | null, config: ICreateTerminalOptions['config'] }) {
		const { cwd: override_cwd, config } = props

		const cwd: URI | string | undefined = (override_cwd ?? undefined) ?? this.workspaceContextService.getWorkspace().folders[0]?.uri

		// create new terminal and return its ID
		const terminal = await this.terminalService.createTerminal({
			cwd: cwd,
			location: TerminalLocation.Panel,
			config: config,
		})

		// when a new terminal is created, there is an initial command that gets run which is empty, wait for it to end before returning
		const disposables: IDisposable[] = []
		const waitForMount = new Promise<void>(res => {
			let data = ''
			const d = terminal.onData(newData => {
				data += newData
				if (isCommandComplete(data)) { res() }
			})
			disposables.push(d)
		})
		const waitForTimeout = new Promise<void>(res => { setTimeout(() => { res() }, 5000) })

		await Promise.any([waitForMount, waitForTimeout,])
		disposables.forEach(d => d.dispose())

		return terminal

	}

	createPersistentTerminal: ITerminalToolService['createPersistentTerminal'] = async ({ cwd }) => {
		const terminalId = this.getValidNewTerminalId();
		const config = { name: persistentTerminalNameOfId(terminalId), title: persistentTerminalNameOfId(terminalId) }
		const terminal = await this._createTerminal({ cwd, config, })
		this.persistentTerminalInstanceOfId[terminalId] = terminal
		return terminalId
	}

	async killPersistentTerminal(terminalId: string) {
		const terminal = this.persistentTerminalInstanceOfId[terminalId]
		if (!terminal) throw new Error(`Kill Terminal: Terminal with ID ${terminalId} did not exist.`);
		terminal.dispose()
		delete this.persistentTerminalInstanceOfId[terminalId]
		return
	}

	persistentTerminalExists(terminalId: string): boolean {
		return terminalId in this.persistentTerminalInstanceOfId
	}


	getTemporaryTerminal(terminalId: string): ITerminalInstance | undefined {
		if (!terminalId) return
		const terminal = this.temporaryTerminalInstanceOfId[terminalId]
		if (!terminal) return // should never happen
		return terminal
	}

	getPersistentTerminal(terminalId: string): ITerminalInstance | undefined {
		if (!terminalId) return
		const terminal = this.persistentTerminalInstanceOfId[terminalId]
		if (!terminal) return // should never happen
		return terminal
	}


	focusPersistentTerminal: ITerminalToolService['focusPersistentTerminal'] = async (terminalId) => {
		if (!terminalId) return
		const terminal = this.persistentTerminalInstanceOfId[terminalId]
		if (!terminal) return // should never happen
		this.terminalService.setActiveInstance(terminal)
		await this.terminalService.focusActiveInstance()
	}




	runCommand: ITerminalToolService['runCommand'] = async (command, params) => {
		const { type } = params
		await this.terminalService.whenConnected;

		let terminal: ITerminalInstance
		const disposables: IDisposable[] = []

		const isPersistent = type === 'persistent'

		if (isPersistent) { // BG process
			const { persistentTerminalId } = params
			terminal = this.persistentTerminalInstanceOfId[persistentTerminalId];
			if (!terminal) throw new Error(`Unexpected internal error: Terminal with ID ${persistentTerminalId} did not exist.`);
		}
		else {
			const { cwd } = params
			terminal = await this._createTerminal({ cwd: cwd, config: { name: 'Void Temporary Terminal', title: 'Void Temporary Terminal' } })
			this.temporaryTerminalInstanceOfId[params.terminalId] = terminal
		}

		const interrupt = () => {
			terminal.dispose()
			if (!isPersistent)
				delete this.temporaryTerminalInstanceOfId[params.terminalId]
		}

		const waitForResult = async () => {
			if (isPersistent) {
				// focus the terminal about to run
				this.terminalService.setActiveInstance(terminal)
				await this.terminalService.focusActiveInstance()
			}

			let result: string = ''
			let resolveReason: TerminalResolveReason | undefined = undefined


			// create this before we send so that  we don't miss events on terminal
			const waitUntilDone = new Promise<void>((res, rej) => {
				const d2 = terminal.onData(async newData => {
					if (resolveReason) return
					result += newData
					// onDone
					const isDone = isCommandComplete(result)
					if (isDone) {
						resolveReason = { type: 'done', exitCode: isDone.exitCode }
						res()
						return
					}
				})
				disposables.push(d2)
			})


			// send the command here
			await terminal.sendText(command, true)

			const waitUntilInterrupt = isPersistent ?
				// timeout after X seconds
				new Promise<void>((res) => {
					setTimeout(() => {
						resolveReason = { type: 'timeout' };
						res()
					}, MAX_TERMINAL_BG_COMMAND_TIME * 1000)
				})
				// inactivity-based timeout
				: new Promise<void>(res => {
					let globalTimeoutId: ReturnType<typeof setTimeout>;
					const resetTimer = () => {
						clearTimeout(globalTimeoutId);
						globalTimeoutId = setTimeout(() => {
							if (resolveReason) return

							resolveReason = { type: 'timeout' };
							res();
						}, MAX_TERMINAL_INACTIVE_TIME * 1000);
					};

					const dTimeout = terminal.onData(() => { resetTimer(); });
					disposables.push(dTimeout, toDisposable(() => clearTimeout(globalTimeoutId)));
					resetTimer();
				})

			// wait for result
			await Promise.any([waitUntilDone, waitUntilInterrupt])

			disposables.forEach(d => d.dispose())
			if (!isPersistent) {
				interrupt()
			}

			if (!resolveReason) throw new Error('Unexpected internal error: Promise.any should have resolved with a reason.')

			result = removeAnsiEscapeCodes(result)
				.split('\n').slice(1, -1) // remove first and last line (first = command, last = andrewpareles/void %)
				.join('\n')

			if (result.length > MAX_TERMINAL_CHARS) {
				const half = MAX_TERMINAL_CHARS / 2
				result = result.slice(0, half)
					+ '\n...\n'
					+ result.slice(result.length - half, Infinity)
			}

			return { result, resolveReason }

		}
		const resPromise = waitForResult()

		return {
			interrupt,
			resPromise,
		}
	}


}

registerSingleton(ITerminalToolService, TerminalToolService, InstantiationType.Delayed);
