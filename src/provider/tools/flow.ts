import vscode from 'vscode';
import { t } from '../../i18n';
import { logToolFlowDiagnostics } from '../debug';
import type { RequestKind } from '../routing';
import { ACTIVATE_TOOL_PREFIX, MAX_PREFLIGHT_ROUNDS_PER_USER_REQUEST } from './consts';
import { createToolDriftNotice, filterProviderNotices } from './notices';
import {
	createPreflightToolCallId,
	filterPreflightControlFlow,
	inspectActivatePreflight,
} from './preflight';

interface ToolFlowOptions {
	stabilizeToolList: boolean;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	tools: readonly vscode.LanguageModelChatTool[] | undefined;
	progress: vscode.Progress<vscode.LanguageModelResponsePart>;
	requestKind: RequestKind;
}

interface ToolFlowResult {
	preflightHandled: boolean;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	initialResponseNotice?: string;
}

export function processToolFlow({
	stabilizeToolList,
	messages,
	tools,
	progress,
	requestKind,
}: ToolFlowOptions): ToolFlowResult {
	const filteredMessages = filterProviderNotices(filterPreflightControlFlow(messages));
	const messagesFiltered = filteredMessages !== messages;

	if (!stabilizeToolList) {
		logToolFlowDiagnostics({
			requestKind,
			tools,
			messagesFiltered,
			preflight: 'skipped',
		});
		return {
			preflightHandled: false,
			messages: filteredMessages,
		};
	}

	const activatePreflight = inspectActivatePreflight(messages, tools);
	if (activatePreflight.remainingActivatorNames.length > 0) {
		if (activatePreflight.rounds >= MAX_PREFLIGHT_ROUNDS_PER_USER_REQUEST) {
			logToolFlowDiagnostics({
				requestKind,
				tools,
				messagesFiltered,
				preflight: 'round-limit',
				activatePreflight,
			});
			throw new Error(
				t('request.preflightRoundLimitExceeded', MAX_PREFLIGHT_ROUNDS_PER_USER_REQUEST),
			);
		}

		const nextRound = activatePreflight.rounds + 1;
		logToolFlowDiagnostics({
			requestKind,
			tools,
			messagesFiltered,
			preflight: 'handled',
			activatePreflight,
			nextRound,
		});
		for (const toolName of activatePreflight.remainingActivatorNames) {
			progress.report(
				new vscode.LanguageModelToolCallPart(
					createPreflightToolCallId(nextRound, toolName),
					toolName,
					{},
				),
			);
		}

		return { preflightHandled: true, messages };
	}

	const hasUnexpandedActivateTools =
		activatePreflight.rounds > 0 &&
		tools?.some((tool) => tool.name.startsWith(ACTIVATE_TOOL_PREFIX));
	logToolFlowDiagnostics({
		requestKind,
		tools,
		messagesFiltered,
		preflight: 'ready',
		activatePreflight,
		initialResponseNotice: hasUnexpandedActivateTools,
	});

	return {
		preflightHandled: false,
		messages: filteredMessages,
		initialResponseNotice: hasUnexpandedActivateTools ? createToolDriftNotice() : undefined,
	};
}
