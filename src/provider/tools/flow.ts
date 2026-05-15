import vscode from 'vscode';
import { t } from '../../i18n';
import { MAX_PREFLIGHT_ROUNDS_PER_USER_REQUEST } from './consts';
import { createToolDriftNotice, filterProviderNotices } from './notices';
import {
	createPreflightToolCallId,
	filterPreflightControlFlow,
	inspectActivatePreflight,
} from './preflight';

interface ToolFlowOptions {
	preExpandActivateTools: boolean;
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
	preExpandActivateTools,
	messages,
	tools,
	progress,
}: ToolFlowOptions): ToolFlowResult {
	const activatePreflight = inspectActivatePreflight(messages, tools);
	if (preExpandActivateTools && activatePreflight.remainingActivatorNames.length > 0) {
		if (activatePreflight.rounds >= MAX_PREFLIGHT_ROUNDS_PER_USER_REQUEST) {
			throw new Error(
				t('request.preflightRoundLimitExceeded', MAX_PREFLIGHT_ROUNDS_PER_USER_REQUEST),
			);
		}

		const nextRound = activatePreflight.rounds + 1;
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

	return {
		preflightHandled: false,
		messages: filterProviderNotices(filterPreflightControlFlow(messages)),
		initialResponseNotice:
			preExpandActivateTools && activatePreflight.rounds > 0 ? createToolDriftNotice() : undefined,
	};
}