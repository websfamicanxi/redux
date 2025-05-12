import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'
import { IVoidSCM } from '../common/voidSCM.js'
import { promisify } from 'util'
import { exec as _exec } from 'child_process'

interface NumStat {
	file: string
	added: number
	removed: number
}

const exec = promisify(_exec)

const git = async (command: string, path: string): Promise<string> => {
	const { stdout } = await exec(`${command}`, { cwd: path })
	//TODO VoidSCM - handle stderr
	return stdout
}

const getNumStat = async (path: string): Promise<NumStat[]> => {
	const output = await git('git diff --numstat', path)
	return output
		.split('\n')
		.map((line) => {
			const [added, removed, file] = line.split('\t')
			return {
				file,
				added: parseInt(added, 10) || 0,
				removed: parseInt(removed, 10) || 0,
			}
		})
}

const getSampledDiff = async (file: string, path: string): Promise<string> => {
	const diff = await git(`git diff --unified=0 --no-color -- "${file}"`, path)
	return diff.slice(0, 2000)
}

export class VoidSCM implements IVoidSCM {
	readonly _serviceBrand: undefined

	async gitStat(path: string): Promise<string> {
		return await git('git diff --stat', path)
	}

	async gitSampledDiffs(path: string): Promise<string> {
		const numStatList = await getNumStat(path)
		const topFiles = numStatList
			.sort((a, b) => (b.added + b.removed) - (a.added + a.removed))
			.slice(0, 10)
		const diffs = await Promise.all(topFiles.map(async ({ file }) => ({ file, diff: await getSampledDiff(file, path) })))
		return diffs.map(({ file, diff }) => `==== ${file} ====\n${diff}`).join('\n\n') //TODO VoidSCM - investigate why file can be undefined
	}
}

registerSingleton(IVoidSCM, VoidSCM, InstantiationType.Delayed)
