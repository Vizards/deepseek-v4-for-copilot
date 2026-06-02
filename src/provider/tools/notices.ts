import vscode from 'vscode';
import { t } from '../../i18n';
import {
	TOOL_DRIFT_NOTICE_END,
	TOOL_DRIFT_NOTICE_START,
	VISION_PROXY_NOTICE_END,
	VISION_PROXY_NOTICE_START,
} from './consts';
import { formatVisionProxyDisplayMessage } from '../vision/protocols/errors';

type LanguageModelChatRequestMessagePart =
	vscode.LanguageModelChatRequestMessage['content'][number];

let visionProxyConfigurationUrl = 'command:deepseek-copilot.setVisionModel';
let showLogsUrl = 'command:deepseek-copilot.showLogs';

export function setVisionProxyConfigurationUrl(url: string): void {
	visionProxyConfigurationUrl = url;
}

export function setProviderNoticeShowLogsUrl(url: string): void {
	showLogsUrl = url;
}

export function createToolDriftNotice(): string {
	return [
		'',
		TOOL_DRIFT_NOTICE_START,
		'',
		createBlockquote(t('notice.toolDrift')),
		'',
		TOOL_DRIFT_NOTICE_END,
		'',
	].join('\n');
}

export function createVisionProxyMissingNotice(): string {
	return [
		'',
		VISION_PROXY_NOTICE_START,
		'',
		createBlockquote(t('notice.visionProxyMissing', visionProxyConfigurationUrl)),
		'',
		VISION_PROXY_NOTICE_END,
		'',
	].join('\n');
}

export function createVisionProxyFailureNotice(errorCode: string, errorMessage: string): string {
	return [
		'',
		VISION_PROXY_NOTICE_START,
		'',
		createBlockquote(
			t(
				'notice.visionProxyFailure',
				escapeBoldText(formatVisionProxyDisplayMessage(errorCode, errorMessage)),
				createConfigureVisionProxyLink(),
				createShowLogsLink(),
			),
		),
		'',
		VISION_PROXY_NOTICE_END,
		'',
	].join('\n');
}

export function filterProviderNotices(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): readonly vscode.LanguageModelChatRequestMessage[] {
	let changed = false;
	const filteredMessages: vscode.LanguageModelChatRequestMessage[] = [];

	for (const message of messages) {
		if (message.role !== vscode.LanguageModelChatMessageRole.Assistant) {
			filteredMessages.push(message);
			continue;
		}

		let messageChanged = false;
		const filteredContent: LanguageModelChatRequestMessagePart[] = [];
		for (const part of message.content) {
			if (!(part instanceof vscode.LanguageModelTextPart)) {
				filteredContent.push(part);
				continue;
			}

			const value = stripProviderNotices(part.value);
			if (value === part.value) {
				filteredContent.push(part);
				continue;
			}

			changed = true;
			messageChanged = true;
			if (value.length > 0) {
				filteredContent.push(new vscode.LanguageModelTextPart(value));
			}
		}

		if (!messageChanged) {
			filteredMessages.push(message);
		} else if (filteredContent.length > 0) {
			filteredMessages.push({ ...message, content: filteredContent });
		} else {
			changed = true;
		}
	}

	return changed ? filteredMessages : messages;
}

function stripProviderNotices(value: string): string {
	let result = value;
	for (const marker of [
		{ start: TOOL_DRIFT_NOTICE_START, end: TOOL_DRIFT_NOTICE_END },
		{ start: VISION_PROXY_NOTICE_START, end: VISION_PROXY_NOTICE_END },
	]) {
		result = stripProviderNotice(result, marker.start, marker.end);
	}
	return result;
}

function stripProviderNotice(value: string, startMarker: string, endMarker: string): string {
	let result = value;
	while (true) {
		const startIndex = result.indexOf(startMarker);
		if (startIndex < 0) {
			return result;
		}

		const endMarkerIndex = result.indexOf(endMarker, startIndex);
		const endIndex = endMarkerIndex < 0 ? result.length : endMarkerIndex + endMarker.length;
		result = removeRangeWithWhitespace(result, startIndex, endIndex);
	}
}

function removeRangeWithWhitespace(value: string, startIndex: number, endIndex: number): string {
	let removeStart = startIndex;
	while (removeStart > 0 && isWhitespace(value.charAt(removeStart - 1))) {
		removeStart -= 1;
	}

	let removeEnd = endIndex;
	while (removeEnd < value.length && isWhitespace(value.charAt(removeEnd))) {
		removeEnd += 1;
	}

	return value.slice(0, removeStart) + value.slice(removeEnd);
}

function isWhitespace(char: string): boolean {
	return char === ' ' || char === '\t' || char === '\r' || char === '\n';
}

function createBlockquote(value: string): string {
	return value
		.split(/\r?\n/)
		.map((line) => (line.length > 0 ? `> ${line}` : '>'))
		.join('\n');
}

function createConfigureVisionProxyLink(): string {
	return `[${t('vision.action.configureProxy')}](${visionProxyConfigurationUrl})`;
}

function createShowLogsLink(): string {
	return `[${t('error.action.viewDetails')}](${showLogsUrl})`;
}

function escapeBoldText(value: string): string {
	return value.replaceAll('*', '\\*');
}
