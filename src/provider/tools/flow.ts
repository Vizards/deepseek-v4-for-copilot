import vscode from 'vscode';
import { t } from '../../i18n';
import { logToolFlowDiagnostics } from '../diagnostics';
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
}: ToolFlowOptions): ToolFlowResult {
	const filteredMessages = filterProviderNotices(filterPreflightControlFlow(messages));
	const filteredProviderMessages = filteredMessages !== messages;

	if (!stabilizeToolList) {
		logToolFlowDiagnostics({
			tools,
			filteredProviderMessages,
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
				tools,
				filteredProviderMessages,
				preflight: 'round-limit',
				activatePreflight,
			});
			throw new Error(
				t('request.preflightRoundLimitExceeded', MAX_PREFLIGHT_ROUNDS_PER_USER_REQUEST),
			);
		}

		const nextRound = activatePreflight.rounds + 1;
		logToolFlowDiagnostics({
			tools,
			filteredProviderMessages,
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
		tools,
		filteredProviderMessages,
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
