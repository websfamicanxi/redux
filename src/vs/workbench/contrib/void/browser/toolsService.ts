import { CancellationToken } from '../../../../base/common/cancellation.js'
import { URI } from '../../../../base/common/uri.js'
import { IFileService } from '../../../../platform/files/common/files.js'
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js'
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js'
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js'
import { ISearchService } from '../../../services/search/common/search.js'
import { IEditCodeService } from './editCodeServiceInterface.js'
import { IVoidFileService } from '../common/voidFileService.js'
import { ITerminalToolService } from './terminalToolService.js'
import { ToolCallParams, ToolDirectoryItem, ToolName, ToolResultType } from '../common/toolsServiceTypes.js'


// tool use for AI




type ValidateParams = { [T in ToolName]: (p: string) => Promise<ToolCallParams[T]> }
type CallTool = { [T in ToolName]: (p: ToolCallParams[T]) => Promise<ToolResultType[T]> }
type ToolResultToString = { [T in ToolName]: (p: ToolCallParams[T], result: ToolResultType[T]) => string }




// pagination info
const MAX_FILE_CHARS_PAGE = 50_000
const MAX_CHILDREN_URIs_PAGE = 500



const computeDirectoryResult = async (
	fileService: IFileService,
	rootURI: URI,
	pageNumber: number = 1
): Promise<ToolResultType['list_dir']> => {
	const stat = await fileService.resolve(rootURI, { resolveMetadata: false });
	if (!stat.isDirectory) {
		return { children: null, hasNextPage: false, hasPrevPage: false, itemsRemaining: 0 };
	}

	const originalChildrenLength = stat.children?.length ?? 0;
	const fromChildIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1);
	const toChildIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1; // INCLUSIVE
	const listChildren = stat.children?.slice(fromChildIdx, toChildIdx + 1) ?? [];

	const children: ToolDirectoryItem[] = listChildren.map(child => ({
		name: child.name,
		uri: child.resource,
		isDirectory: child.isDirectory,
		isSymbolicLink: child.isSymbolicLink
	}));

	const hasNextPage = (originalChildrenLength - 1) > toChildIdx;
	const hasPrevPage = pageNumber > 1;
	const itemsRemaining = Math.max(0, originalChildrenLength - (toChildIdx + 1));

	return {
		children,
		hasNextPage,
		hasPrevPage,
		itemsRemaining
	};
};

const directoryResultToString = (params: ToolCallParams['list_dir'], result: ToolResultType['list_dir']): string => {
	if (!result.children) {
		return `Error: ${params.rootURI} is not a directory`;
	}

	let output = '';
	const entries = result.children;

	if (!result.hasPrevPage) {
		output += `${params.rootURI}\n`;
	}

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		const isLast = i === entries.length - 1 && !result.hasNextPage;
		const prefix = isLast ? '└── ' : '├── ';

		output += `${prefix}${entry.name}${entry.isDirectory ? '/' : ''}${entry.isSymbolicLink ? ' (symbolic link)' : ''}\n`;
	}

	if (result.hasNextPage) {
		output += `└── (${result.itemsRemaining} results remaining...)\n`;
	}

	return output;
};





const validateJSON = (s: string): { [s: string]: unknown } => {
	try {
		const o = JSON.parse(s)
		return o
	}
	catch (e) {
		throw new Error(`Tool parameter was not a string of a valid JSON: "${s}".`)
	}
}



const validateStr = (argName: string, value: unknown) => {
	if (typeof value !== 'string') throw new Error(`Error: ${argName} must be a string.`)
	return value
}


// TODO!!!! check to make sure in workspace
const validateURI = (uriStr: unknown) => {
	if (typeof uriStr !== 'string') throw new Error('Error: provided uri must be a string.')

	const uri = URI.file(uriStr)
	return uri
}

const validatePageNum = (pageNumberUnknown: unknown) => {
	if (!pageNumberUnknown) return 1
	const parsedInt = Number.parseInt(pageNumberUnknown + '')
	if (!Number.isInteger(parsedInt)) throw new Error(`Page number was not an integer: "${pageNumberUnknown}".`)
	if (parsedInt < 1) throw new Error(`Specified page number must be 1 or greater: "${pageNumberUnknown}".`)
	return parsedInt
}

const validateRecursiveParamStr = (paramsUnknown: unknown) => {
	if (typeof paramsUnknown !== 'string') throw new Error('Error calling tool: provided params must be a string.')
	const params = paramsUnknown
	const isRecursive = params.includes('r')
	return isRecursive
}

const validateProposedTerminalId = (terminalIdUnknown: unknown) => {
	const terminalId = terminalIdUnknown + ''
	if (!terminalId) return ''
	return terminalId
}

export interface IToolsService {
	readonly _serviceBrand: undefined;
	validateParams: ValidateParams;
	callTool: CallTool;
	stringOfResult: ToolResultToString;
}

export const IToolsService = createDecorator<IToolsService>('ToolsService');

export class ToolsService implements IToolsService {

	readonly _serviceBrand: undefined;

	public validateParams: ValidateParams;
	public callTool: CallTool;
	public stringOfResult: ToolResultToString;


	constructor(
		@IFileService fileService: IFileService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@ISearchService searchService: ISearchService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IVoidFileService voidFileService: IVoidFileService,
		@IEditCodeService editCodeService: IEditCodeService,
		@ITerminalToolService private readonly terminalToolService: ITerminalToolService,
	) {

		const queryBuilder = instantiationService.createInstance(QueryBuilder);

		this.validateParams = {
			read_file: async (params: string) => {
				const o = validateJSON(params)
				const { uri: uriStr, pageNumber: pageNumberUnknown } = o

				const uri = validateURI(uriStr)
				const pageNumber = validatePageNum(pageNumberUnknown)

				return { uri, pageNumber }
			},
			list_dir: async (params: string) => {
				const o = validateJSON(params)
				const { uri: uriStr, pageNumber: pageNumberUnknown } = o

				const uri = validateURI(uriStr)
				const pageNumber = validatePageNum(pageNumberUnknown)
				return { rootURI: uri, pageNumber }
			},
			pathname_search: async (params: string) => {
				const o = validateJSON(params)
				const { query: queryUnknown, pageNumber: pageNumberUnknown } = o

				const queryStr = validateStr('query', queryUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)

				return { queryStr, pageNumber }

			},
			search: async (params: string) => {
				const o = validateJSON(params)
				const { query: queryUnknown, pageNumber: pageNumberUnknown } = o

				const queryStr = validateStr('query', queryUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)

				return { queryStr, pageNumber }
			},

			// ---

			create_uri: async (params: string) => {
				const o = validateJSON(params)
				const { uri: uriStr } = o
				const uri = validateURI(uriStr)
				return { uri }
			},

			delete_uri: async (params: string) => {
				const o = validateJSON(params)
				const { uri: uriStr, params: paramsStr } = o
				const uri = validateURI(uriStr)
				const isRecursive = validateRecursiveParamStr(paramsStr)
				return { uri, isRecursive }
			},

			edit: async (params: string) => {
				const o = validateJSON(params)
				const { uri: uriStr, changeDescription: changeDescriptionUnknown } = o
				const uri = validateURI(uriStr)
				const changeDescription = validateStr('changeDescription', changeDescriptionUnknown)

				return { uri, changeDescription }
			},

			terminal_command: async (s: string) => {
				const o = validateJSON(s)
				const { command: commandUnknown, terminalId: terminalIdUnknown } = o
				const command = validateStr('command', commandUnknown)
				const proposedTerminalId = validateProposedTerminalId(terminalIdUnknown)
				return { command, proposedTerminalId }
			},

		}


		this.callTool = {
			read_file: async ({ uri, pageNumber }) => {
				const readFileContents = await voidFileService.readFile(uri)

				const fromIdx = MAX_FILE_CHARS_PAGE * (pageNumber - 1)
				const toIdx = MAX_FILE_CHARS_PAGE * pageNumber - 1
				const fileContents = readFileContents.slice(fromIdx, toIdx + 1) // paginate
				const hasNextPage = (readFileContents.length - 1) - toIdx >= 1
				return { fileContents, hasNextPage }
			},

			list_dir: async ({ rootURI, pageNumber }) => {
				const dirResult = await computeDirectoryResult(fileService, rootURI, pageNumber)
				return dirResult
			},

			pathname_search: async ({ queryStr, pageNumber }) => {
				const query = queryBuilder.file(workspaceContextService.getWorkspace().folders.map(f => f.uri), { filePattern: queryStr, })
				const data = await searchService.fileSearch(query, CancellationToken.None)

				const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1)
				const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1
				const uris = data.results
					.slice(fromIdx, toIdx + 1) // paginate
					.map(({ resource, results }) => resource)

				const hasNextPage = (data.results.length - 1) - toIdx >= 1
				return { uris, hasNextPage }
			},

			search: async ({ queryStr, pageNumber }) => {
				const query = queryBuilder.text({ pattern: queryStr, }, workspaceContextService.getWorkspace().folders.map(f => f.uri))
				const data = await searchService.textSearch(query, CancellationToken.None)

				const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1)
				const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1
				const uris = data.results
					.slice(fromIdx, toIdx + 1) // paginate
					.map(({ resource, results }) => resource)

				const hasNextPage = (data.results.length - 1) - toIdx >= 1
				return { queryStr, uris, hasNextPage }
			},

			// ---

			create_uri: async ({ uri }) => {
				await fileService.createFile(uri)
				return {}
			},

			delete_uri: async ({ uri, isRecursive }) => {
				await fileService.del(uri, { recursive: isRecursive })
				return {}
			},

			edit: async ({ uri, changeDescription }) => {
				const [_, applyDonePromise] = editCodeService.startApplying({
					uri,
					applyStr: changeDescription,
					from: 'ClickApply',
					type: 'searchReplace',
				}) ?? []
				await applyDonePromise
				return {}
			},
			terminal_command: async ({ command, proposedTerminalId }) => {
				const { terminalId, didCreateTerminal } = await this.terminalToolService.runCommand(command, proposedTerminalId)
				return { terminalId, didCreateTerminal }
			},
		}


		const nextPageStr = (hasNextPage: boolean) => hasNextPage ? '\n\n(more on next page...)' : ''

		// given to the LLM after the call
		this.stringOfResult = {
			read_file: (params, result) => {
				return result.fileContents + nextPageStr(result.hasNextPage)
			},
			list_dir: (params, result) => {
				const dirTreeStr = directoryResultToString(params, result)
				return dirTreeStr + nextPageStr(result.hasNextPage)
			},
			pathname_search: (params, result) => {
				return result.uris.map(uri => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage)
			},
			search: (params, result) => {
				return result.uris.map(uri => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage)
			},
			// ---
			create_uri: (params, result) => {
				return `URI ${params.uri.fsPath} successfully created.`
			},
			delete_uri: (params, result) => {
				return `URI ${params.uri.fsPath} successfully deleted.`
			},
			edit: (params, result) => {
				return `Change successfully made ${params.uri.fsPath} successfully deleted.`
			},
			terminal_command: (params, result) => {
				return `Terminal command "${params.command}" successfully executed in terminal ${result.terminalId}${result.didCreateTerminal ? `(a newly-created terminal)` : ''}.`
			},

		}



	}


}

registerSingleton(IToolsService, ToolsService, InstantiationType.Eager);
