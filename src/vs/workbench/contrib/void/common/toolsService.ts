import { CancellationToken } from '../../../../base/common/cancellation.js'
import { URI } from '../../../../base/common/uri.js'
import { IFileService, IFileStat } from '../../../../platform/files/common/files.js'
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js'
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js'
import { VSReadFileRaw } from '../../../../workbench/contrib/void/browser/helpers/readFile.js'
import { QueryBuilder } from '../../../../workbench/services/search/common/queryBuilder.js'
import { ISearchService } from '../../../../workbench/services/search/common/search.js'


// tool use for AI



// we do this using Anthropic's style and convert to OpenAI style later
export type InternalToolInfo = {
	description: string,
	params: {
		[paramName: string]: { type: string, description: string | undefined } // name -> type
	},
	required: string[], // required paramNames
}

// helper
const pagination = {
	desc: `Very large results may be paginated (indicated in the result). Pagination fails gracefully if out of bounds or invalid page number.`,
	param: { pageNumber: { type: 'number', description: 'The page number (optional, default is 1).' }, }
} as const

export const contextTools = {
	read_file: {
		description: 'Returns file contents of a given URI.',
		params: {
			uri: { type: 'string', description: undefined },
		},
		required: ['uri'],
	},

	list_dir: {
		description: `Returns all file names and folder names in a given URI. ${pagination.desc}`,
		params: {
			uri: { type: 'string', description: undefined },
			...pagination.param
		},
		required: ['uri'],
	},

	pathname_search: {
		description: `Returns all pathnames that match a given grep query. You should use this when looking for a file with a specific name or path. This does NOT search file content. ${pagination.desc}`,
		params: {
			query: { type: 'string', description: undefined },
			...pagination.param,
		},
		required: ['query']
	},

	search: {
		description: `Returns all code excerpts containing the given string or grep query. This does NOT search pathname. As a follow-up, you may want to use read_file to view the full file contents of the results. ${pagination.desc}`,
		params: {
			query: { type: 'string', description: undefined },
			...pagination.param,
		},
		required: ['query'],
	},

	// semantic_search: {
	// 	description: 'Searches files semantically for the given string query.',
	// 	// RAG
	// },

} as const satisfies { [name: string]: InternalToolInfo }

export type ContextToolName = keyof typeof contextTools
type ContextToolParamNames<T extends ContextToolName> = keyof typeof contextTools[T]['params']
type ContextToolParams<T extends ContextToolName> = { [paramName in ContextToolParamNames<T>]: unknown }

type AllContextToolCallFns = {
	[ToolName in ContextToolName]: ((p: (ContextToolParams<ToolName>)) => Promise<string>)
}







// TODO check to make sure in workspace
// TODO check to make sure is not gitignored


async function generateDirectoryTreeMd(fileService: IFileService, rootURI: URI): Promise<string> {
	let output = ''
	function traverseChildren(children: IFileStat[], depth: number) {
		const indentation = '  '.repeat(depth);
		for (const child of children) {
			output += `${indentation}- ${child.name}\n`;
			traverseChildren(child.children ?? [], depth + 1);
		}
	}
	const stat = await fileService.resolve(rootURI, { resolveMetadata: false });

	// kickstart recursion
	output += `${stat.name}\n`;
	traverseChildren(stat.children ?? [], 1);

	return output;
}


const validateURI = (uriStr: unknown) => {
	if (typeof uriStr !== 'string') throw new Error('(uri was not a string)')
	const uri = URI.file(uriStr)
	return uri
}

export interface IToolService {
	readonly _serviceBrand: undefined;
	callContextTool: <T extends ContextToolName>(toolName: T, params: ContextToolParams<T>) => Promise<string>
}

export const IToolService = createDecorator<IToolService>('ToolService');

export class ToolService implements IToolService {

	readonly _serviceBrand: undefined;

	contextToolCallFns: AllContextToolCallFns

	constructor(
		@IFileService fileService: IFileService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@ISearchService searchService: ISearchService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {


		const queryBuilder = instantiationService.createInstance(QueryBuilder);

		this.contextToolCallFns = {
			read_file: async ({ uri: uriStr }) => {
				const uri = validateURI(uriStr)
				const fileContents = await VSReadFileRaw(fileService, uri)
				return fileContents ?? '(could not read file)'
			},
			list_dir: async ({ uri: uriStr }) => {
				const uri = validateURI(uriStr)
				const treeStr = await generateDirectoryTreeMd(fileService, uri)
				return treeStr
			},
			pathname_search: async ({ query: queryStr }) => {
				if (typeof queryStr !== 'string') return '(Error: query was not a string)'
				const query = queryBuilder.file(workspaceContextService.getWorkspace().folders.map(f => f.uri), { filePattern: queryStr, });

				const data = await searchService.fileSearch(query, CancellationToken.None);
				const str = data.results.map(({ resource, results }) => resource.fsPath).join('\n')
				return str
			},
			search: async ({ query: queryStr }) => {
				if (typeof queryStr !== 'string') return '(Error: query was not a string)'
				const query = queryBuilder.text({ pattern: queryStr, }, workspaceContextService.getWorkspace().folders.map(f => f.uri));

				const data = await searchService.textSearch(query, CancellationToken.None);
				const str = data.results.map(({ resource, results }) => resource.fsPath).join('\n')
				return str
			},

		}



	}

	callContextTool: IToolService['callContextTool'] = (toolName, params) => {
		return this.contextToolCallFns[toolName](params)
	}


}

registerSingleton(IToolService, ToolService, InstantiationType.Eager);

