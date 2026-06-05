import vscode from 'vscode';
import type { DeepSeekRequest, DeepSeekTool } from '../../types';

export type RequestKind =
	| 'main-agent'
	| 'terminal-steering'
	| 'todo-tracker'
	| 'settings-resolver'
	| 'prompt-categorizer'
	| 'chat-title'
	| 'inline-progress-message'
	| 'git-branch-name'
	| 'git-commit-message'
	| 'rename-suggestions'
	| 'background'
	| 'unknown';

const TODO_TRACKER_PREFIX = 'You are a background task tracker';
const PROMPT_CATEGORIZER_PREFIX = 'You are an expert classifier for AI coding assistant prompts';
const SETTINGS_RESOLVER_PREFIX =
	'You are a Visual Studio Code assistant. Your job is to assist users in using Visual Studio Code by returning settings';
const CHAT_TITLE_PREFIXES = [
	'You are an expert in crafting ultra-compact titles',
	'You are an expert in crafting pithy titles',
] as const;
const INLINE_PROGRESS_MESSAGE_PREFIX =
	'You are an expert in writing short, catchy, and encouraging progress messages';
const GIT_BRANCH_NAME_PREFIX = 'You are an expert in crafting pithy branch names';
const GIT_COMMIT_MESSAGE_PREFIX =
	'You are an AI programming assistant, helping a software developer to come with the best git commit message';
const RENAME_SUGGESTIONS_PREFIX = 'You are a distinguished software engineer';
const MAIN_AGENT_PREFIX = 'You are an expert AI programming assistant';
const TERMINAL_NOTIFICATION_PATTERN = /^\[Terminal\s+\S+\s+notification:/;
const REQUEST_KINDS_WITH_FORCED_NONE_THINKING = new Set<RequestKind>([
	'todo-tracker',
	'prompt-categorizer',
	'settings-resolver',
	'chat-title',
	'inline-progress-message',
	'git-branch-name',
	'git-commit-message',
	'rename-suggestions',
]);

export function formatModelFields(vscodeModelId: string, apiModelId?: string): string {
	const apiField = apiModelId && apiModelId !== vscodeModelId ? ` apiModel=${apiModelId}` : '';
	return `model=${vscodeModelId}${apiField}`;
}

export function formatRequestLogLine(requestKind: RequestKind, message: string): string {
	return `[${requestKind}] ${message}`;
}

export function shouldForceThinkingNone(requestKind: RequestKind): boolean {
	return REQUEST_KINDS_WITH_FORCED_NONE_THINKING.has(requestKind);
}

export function classifyProviderRequest(input: {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	tools?: readonly vscode.LanguageModelChatTool[];
}): RequestKind {
	return classifyRequest({
		firstText: getFirstVscodeText(input.messages),
		latestUserText: getLatestVscodeUserText(input.messages),
		toolNames: input.tools?.map((tool) => tool.name) ?? [],
	});
}

export function classifyDeepSeekRequest(input: {
	request: DeepSeekRequest;
	inputMessages?: readonly vscode.LanguageModelChatRequestMessage[];
}): RequestKind {
	return classifyRequest({
		firstText:
			input.request.messages[0]?.content ??
			(input.inputMessages ? getFirstVscodeText(input.inputMessages) : ''),
		latestUserText:
			(input.inputMessages ? getLatestVscodeUserText(input.inputMessages) : '') ||
			getLatestDeepSeekUserText(input.request),
		toolNames: input.request.tools?.map(getDeepSeekToolName) ?? [],
	});
}

function classifyRequest(input: {
	firstText: string;
	latestUserText: string;
	toolNames: readonly string[];
}): RequestKind {
	const firstText = input.firstText.trimStart();
	const latestUserText = input.latestUserText.trimStart();
	if (TERMINAL_NOTIFICATION_PATTERN.test(latestUserText)) {
		return 'terminal-steering';
	}
	if (
		isOnlyTool(input.toolNames, 'manage_todo_list') ||
		firstText.startsWith(TODO_TRACKER_PREFIX)
	) {
		return 'todo-tracker';
	}
	if (
		isOnlyTool(input.toolNames, 'categorize_prompt') ||
		firstText.startsWith(PROMPT_CATEGORIZER_PREFIX)
	) {
		return 'prompt-categorizer';
	}
	if (firstText.startsWith(SETTINGS_RESOLVER_PREFIX)) {
		return 'settings-resolver';
	}
	if (startsWithAny(firstText, CHAT_TITLE_PREFIXES)) {
		return 'chat-title';
	}
	if (firstText.startsWith(INLINE_PROGRESS_MESSAGE_PREFIX)) {
		return 'inline-progress-message';
	}
	if (firstText.startsWith(GIT_BRANCH_NAME_PREFIX)) {
		return 'git-branch-name';
	}
	if (firstText.startsWith(GIT_COMMIT_MESSAGE_PREFIX)) {
		return 'git-commit-message';
	}
	if (firstText.startsWith(RENAME_SUGGESTIONS_PREFIX)) {
		return 'rename-suggestions';
	}
	if (
		firstText.startsWith(MAIN_AGENT_PREFIX) ||
		firstText.includes('<skills>') ||
		firstText.includes('<agents>')
	) {
		return 'main-agent';
	}
	if (input.toolNames.length > 0 || firstText.length > 0) {
		return 'background';
	}
	return 'unknown';
}

function isOnlyTool(toolNames: readonly string[], toolName: string): boolean {
	return toolNames.length === 1 && toolNames[0] === toolName;
}

function startsWithAny(text: string, prefixes: readonly string[]): boolean {
	return prefixes.some((prefix) => text.startsWith(prefix));
}

function getDeepSeekToolName(tool: DeepSeekTool): string {
	return tool.function.name;
}

function getFirstVscodeText(messages: readonly vscode.LanguageModelChatRequestMessage[]): string {
	const firstMessage = messages[0];
	if (!firstMessage) {
		return '';
	}

	return getVscodeMessageText(firstMessage);
}

function getLatestVscodeUserText(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === vscode.LanguageModelChatMessageRole.User) {
			return getVscodeMessageText(message);
		}
	}
	return '';
}

function getVscodeMessageText(message: vscode.LanguageModelChatRequestMessage): string {
	let text = '';
	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			text += part.value;
		}
	}
	return text;
}

function getLatestDeepSeekUserText(request: DeepSeekRequest): string {
	for (let index = request.messages.length - 1; index >= 0; index -= 1) {
		const message = request.messages[index];
		if (message.role === 'user') {
			return message.content;
		}
	}
	return '';
}
