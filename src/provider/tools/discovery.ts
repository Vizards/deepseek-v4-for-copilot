import type { CancellationToken } from 'vscode';
import type {
	DeepSeekMessage,
	DeepSeekRequest,
	DeepSeekTool,
	DeepSeekToolCall,
	StreamCallbacks,
} from '../../types';

export interface CompletionClient {
	streamChatCompletion(
		request: DeepSeekRequest,
		callbacks: StreamCallbacks,
		token: CancellationToken,
	): Promise<void>;
}

const MAX_SEARCH_ROUNDS = 4;
const CORE_NAMES = new Set([
	'view',
	'grep',
	'glob',
	'powershell',
	'bash',
	'read_powershell',
	'write_powershell',
	'list_powershell',
	'readFile',
	'listDirectory',
	'runInTerminal',
	'apply_patch',
	'edit',
	'create',
	'report_intent',
	'task_complete',
	'ask_user',
]);

function words(text: string): string[] {
	return (
		text
			.replace(/([a-z])([A-Z])/g, '$1 $2')
			.toLowerCase()
			.match(/[\p{L}\p{N}]+/gu) ?? []
	);
}

/** Per-request catalog. Only tools the host supplied are eligible for discovery. */
export class ToolCatalog {
	readonly searchName: string;
	readonly budget: number;
	private readonly tools = new Map<string, DeepSeekTool>();
	private selected: string[];

	constructor(tools: DeepSeekTool[], messages: DeepSeekMessage[], budget: number) {
		this.budget = Number.isFinite(budget) ? Math.max(8, Math.min(128, Math.floor(budget))) : 64;
		for (const tool of tools) {
			if (this.tools.has(tool.function.name))
				throw new Error('Duplicate tool name in discovery catalog.');
			this.tools.set(tool.function.name, tool);
		}
		let name = 'deepseek_search_tools';
		for (let suffix = 1; this.tools.has(name); suffix += 1)
			name = `deepseek_search_tools_${suffix}`;
		this.searchName = name;
		const recent = messages
			.slice(-12)
			.reverse()
			.flatMap((message) => (message.tool_calls ?? []).map((call) => call.function.name));
		const core = tools
			.filter((tool) => CORE_NAMES.has(tool.function.name))
			.map((tool) => tool.function.name);
		this.selected = [...new Set([...recent, ...core])]
			.filter((name) => this.tools.has(name))
			.slice(0, this.budget - 1);
	}

	get wireTools(): DeepSeekTool[] {
		return [this.searchTool, ...this.selected.map((name) => this.tools.get(name)!)];
	}

	/** Selection limits schemas sent upstream, not which host-provided tools may be called. */
	hasHostTool(name: string): boolean {
		return this.tools.has(name);
	}

	private get searchTool(): DeepSeekTool {
		return {
			type: 'function',
			function: {
				name: this.searchName,
				description: `Find and activate tools from the ${this.tools.size} tools supplied by the host, including MCP tools. Search by capability, server or exact tool name. Use an empty query and offset to browse every tool. Results become callable on the next response. This only searches tool descriptions; it does not execute tools. Call search separately from other tools.`,
				parameters: {
					type: 'object',
					properties: {
						query: {
							type: 'string',
							description: 'Keywords or exact name; empty string lists all tools.',
						},
						offset: { type: 'integer', minimum: 0, description: 'Pagination offset; default 0.' },
						limit: { type: 'integer', minimum: 1, maximum: 12, description: 'Default 8.' },
					},
					required: ['query'],
					additionalProperties: false,
				},
			},
		};
	}

	search(argumentsJson: string): string {
		let args: { query?: unknown; offset?: unknown; limit?: unknown };
		try {
			args = JSON.parse(argumentsJson);
		} catch {
			return JSON.stringify({
				error: 'Search arguments must be a JSON object with a string query.',
			});
		}
		if (
			!args ||
			typeof args.query !== 'string' ||
			args.query.length > 2000 ||
			(args.offset !== undefined && (!Number.isInteger(args.offset) || Number(args.offset) < 0)) ||
			(args.limit !== undefined && (!Number.isInteger(args.limit) || Number(args.limit) < 1))
		) {
			return JSON.stringify({
				error:
					'Use a string query (up to 2000 characters), nonnegative integer offset and positive integer limit.',
			});
		}
		const terms = [...new Set(words(args.query))];
		const ranked = [...this.tools.values()]
			.map((tool) => {
				const name = words(tool.function.name).join(' ');
				const description = words(tool.function.description ?? '').join(' ');
				const score =
					tool.function.name.toLowerCase() === args.query!.toString().toLowerCase()
						? 10000
						: terms.reduce(
								(sum, term) =>
									sum + (name.includes(term) ? 5 : 0) + (description.includes(term) ? 1 : 0),
								0,
							);
				return { tool, score };
			})
			.filter((item) => terms.length === 0 || item.score > 0)
			.sort(
				(a, b) => b.score - a.score || a.tool.function.name.localeCompare(b.tool.function.name),
			);
		const offset = Number(args.offset ?? 0);
		const limit = Math.min(Number(args.limit ?? 8), 12, this.budget - 1);
		const found = ranked.slice(offset, offset + limit).map((item) => item.tool);
		this.selected = [
			...new Set([...found.map((tool) => tool.function.name), ...this.selected]),
		].slice(0, this.budget - 1);
		return JSON.stringify({
			tools: found.map((tool) => ({
				name: tool.function.name,
				description: tool.function.description?.slice(0, 500),
			})),
			total: ranked.length,
			nextOffset: offset + found.length < ranked.length ? offset + found.length : null,
			hint: found.length
				? 'These tools are now available with their original parameter schemas.'
				: 'No match. Try other keywords, an exact name, or an empty query to browse the catalog.',
		});
	}
}

/** Internal search calls stay inside the provider; real calls go back to Copilot for execution. */
export class ToolDiscoveryClient implements CompletionClient {
	constructor(
		private readonly upstream: CompletionClient,
		private readonly catalog: ToolCatalog,
	) {}

	async streamChatCompletion(
		request: DeepSeekRequest,
		callbacks: StreamCallbacks,
		token: CancellationToken,
	): Promise<void> {
		const messages = [...request.messages];
		for (let round = 0; round <= MAX_SEARCH_ROUNDS; round += 1) {
			if (token.isCancellationRequested) return;
			const tools = this.catalog.wireTools;
			const calls: DeepSeekToolCall[] = [];
			const chunks: Array<{ kind: 'content' | 'thinking'; text: string }> = [];
			let completed = false;
			await this.upstream.streamChatCompletion(
				{ ...request, messages: [...messages], tools },
				{
					onContent: (text) => chunks.push({ kind: 'content', text }),
					onThinking: (text) => chunks.push({ kind: 'thinking', text }),
					onToolCall: (call) => calls.push(call),
					onUsage: (usage) => callbacks.onUsage?.(usage),
					onError: (error) => {
						throw error;
					},
					onDone: () => {
						completed = true;
					},
				},
				token,
			);
			if (token.isCancellationRequested) return;
			if (!completed) throw new Error('Tool discovery response ended without completion.');
			const searches = calls.filter((call) => call.function.name === this.catalog.searchName);
			const realCalls = calls.filter((call) => call.function.name !== this.catalog.searchName);
			const unavailable = realCalls.filter((call) => !this.catalog.hasHostTool(call.function.name));
			if (!unavailable.length && (!searches.length || realCalls.length)) {
				if (request.tool_choice === 'required' && !realCalls.length) {
					throw new Error('A real tool call was required, but the model returned no tool call.');
				}
				// Mixed search/real responses yield real calls immediately. Never fabricate their results
				// or execute them inside this provider; the host keeps its normal approval flow.
				for (const chunk of chunks) {
					if (chunk.kind === 'content') callbacks.onContent(chunk.text);
					else callbacks.onThinking(chunk.text);
				}
				for (const call of realCalls) callbacks.onToolCall(call);
				callbacks.onDone();
				return;
			}
			if (round === MAX_SEARCH_ROUNDS)
				throw new Error(
					unavailable.length
						? `Tool discovery could not recover after four continuations; unavailable host tools: ${[...new Set(unavailable.map((call) => call.function.name))].slice(0, 5).join(', ')}.`
						: 'Tool discovery exceeded four search rounds. Narrow the request and retry.',
				);
			messages.push({
				role: 'assistant',
				content: chunks
					.filter((chunk) => chunk.kind === 'content')
					.map((chunk) => chunk.text)
					.join(''),
				reasoning_content: chunks
					.filter((chunk) => chunk.kind === 'thinking')
					.map((chunk) => chunk.text)
					.join(''),
				tool_calls: calls,
			});
			for (const call of calls)
				messages.push({
					role: 'tool',
					tool_call_id: call.id,
					content:
						call.function.name === this.catalog.searchName
							? this.catalog.search(call.function.arguments)
							: JSON.stringify({
									error: this.catalog.hasHostTool(call.function.name)
										? 'This tool was not executed because the same response requested an unavailable tool. Reissue this call if still needed.'
										: `This tool is not available in the current host-provided catalog and was not executed. Choose an available tool or use ${this.catalog.searchName} to find one.`,
								}),
				});
		}
	}
}
