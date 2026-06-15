import { randomBytes } from 'crypto';
import vscode from 'vscode';
import { t } from '../../../i18n';
import type { VisionLanguageModelOption, VisionProxyConfig, VisionProxySource } from '../types';
import { getVisionProxyPanelScript } from './script';
import { getVisionProxyPanelStyle } from './style';

export interface VisionProxyPanelState {
	source: VisionProxySource;
	config?: VisionProxyConfig;
	hasApiKey: boolean;
	lmModels: VisionLanguageModelOption[];
	selectedLmModelKey?: string;
}

export function getVisionProxyPanelHtml(
	webview: vscode.Webview,
	state: VisionProxyPanelState,
): string {
	const nonce = createNonce();
	const htmlLang = vscode.env.language.toLowerCase() === 'zh-cn' ? 'zh-CN' : 'en';
	const strings = getVisionProxyPanelStrings();
	const initialState = escapeScriptJson(state);
	const initialStrings = escapeScriptJson(strings);
	const csp = [
		"default-src 'none'",
		`style-src 'nonce-${nonce}'`,
		`script-src 'nonce-${nonce}'`,
		`img-src ${webview.cspSource} data:`,
	].join('; ');

	return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(strings.title)}</title>
	<style nonce="${nonce}">${getVisionProxyPanelStyle()}</style>
</head>
<body>
	<main>
		<h1>${escapeHtml(strings.title)}</h1>
		<p class="intro">${escapeHtml(strings.description)}</p>
		<div id="summary" class="summary">
			<div class="summary-dot"></div>
			<div>
				<div id="summaryTitle" class="summary-title"></div>
				<div id="summaryDetail" class="summary-detail"></div>
			</div>
		</div>
		<form id="form">
			<fieldset>
				<div id="sourceField" class="field">
					<div id="sourceLabel" class="field-label">${escapeHtml(strings.fieldSource)}</div>
					<div class="source-options" role="radiogroup" aria-labelledby="sourceLabel">
						<label class="source-option">
							<input id="sourceVscodeLm" type="radio" name="source" value="vscode-lm">
							<span>${escapeHtml(strings.sourceVscodeLm)}</span>
						</label>
						<label class="source-option">
							<input id="sourceApiEndpoint" type="radio" name="source" value="api-endpoint">
							<span>${escapeHtml(strings.sourceApiEndpoint)}</span>
						</label>
					</div>
				</div>
				<div id="lmSection" class="section">
					<div class="field">
						<label for="lmModelKey">${escapeHtml(strings.fieldVisionModel)}</label>
						<select id="lmModelKey"></select>
						<div id="lmModelCost" class="hint" hidden></div>
					</div>
				</div>
				<div id="endpointSection" class="section">
					<div class="field">
						<label for="url">${escapeHtml(strings.fieldEndpointUrl)}</label>
						<input id="url" type="url" placeholder="${escapeHtml(strings.placeholderOpenAIEndpoint)}">
					</div>
					<div class="field">
						<label for="endpointType">${escapeHtml(strings.fieldEndpointType)}</label>
						<select id="endpointType">
							<option value="">${escapeHtml(strings.placeholderEndpointType)}</option>
							<option value="openai-chat-completions">${escapeHtml(strings.endpointTypeOpenAIChatCompletions)}</option>
							<option value="openai-responses">${escapeHtml(strings.endpointTypeOpenAIResponses)}</option>
							<option value="anthropic-messages">${escapeHtml(strings.endpointTypeAnthropicMessages)}</option>
						</select>
						<div id="endpointTypeHint" class="hint"></div>
					</div>
					<div class="field">
						<label for="apiKey">${escapeHtml(strings.fieldApiKey)}</label>
						<input id="apiKey" type="password" autocomplete="off">
						<div id="apiKeyHint" class="hint"></div>
					</div>
					<div class="field">
						<label for="modelId">${escapeHtml(strings.fieldModelId)}</label>
						<input id="modelId" placeholder="gpt-4o-mini">
					</div>
					<div class="field">
						<label for="headers">${escapeHtml(strings.fieldCustomHeaders)}</label>
						<textarea id="headers" spellcheck="false" placeholder="{
  &quot;X-Custom-Header&quot;: &quot;value&quot;
}"></textarea>
						<div class="hint">${escapeHtml(strings.hintCustomHeaders)}</div>
					</div>
					<div class="field">
						<label for="extraBody">${escapeHtml(strings.fieldExtraBody)}</label>
						<textarea id="extraBody" spellcheck="false" placeholder="{
  &quot;temperature&quot;: 0,
  &quot;max_tokens&quot;: 1024
}"></textarea>
						<div class="hint">${escapeHtml(strings.hintExtraBody)}</div>
					</div>
				</div>
			</fieldset>
			<div class="actions">
				<button id="save" type="submit">${escapeHtml(strings.actionSave)}</button>
				<button id="test" class="secondary" type="button">${escapeHtml(strings.actionTest)}</button>
			</div>
			<div id="status" class="status" aria-live="polite"></div>
			<div id="testResult" class="test-result" hidden>
				<div class="test-result-grid">
					<div class="test-result-pane">
						<div class="test-result-label">${escapeHtml(strings.testImage)}</div>
						<img id="testImage" class="test-image" alt="${escapeHtml(strings.testImage)}">
					</div>
					<div class="test-result-pane">
						<div class="test-result-label">${escapeHtml(strings.testResponse)}</div>
						<pre id="testResponse" class="test-response"></pre>
					</div>
				</div>
			</div>
		</form>
	</main>
	<script nonce="${nonce}">${getVisionProxyPanelScript(initialState, initialStrings)}</script>
</body>
</html>`;
}

function createNonce(): string {
	return randomBytes(16).toString('base64');
}

function escapeScriptJson(value: unknown): string {
	return JSON.stringify(value)
		.replaceAll('<', '\\u003c')
		.replaceAll('\u2028', '\\u2028')
		.replaceAll('\u2029', '\\u2029');
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function getVisionProxyPanelStrings() {
	return {
		title: t('vision.panel.title'),
		description: t('vision.panel.description'),
		sourceVscodeLm: t('vision.panel.source.vscodeLm'),
		sourceApiEndpoint: t('vision.panel.source.apiEndpoint'),
		fieldSource: t('vision.panel.field.source'),
		fieldVisionModel: t('vision.panel.field.visionModel'),
		fieldEndpointType: t('vision.panel.field.endpointType'),
		fieldEndpointUrl: t('vision.panel.field.endpointUrl'),
		fieldApiKey: t('vision.panel.field.apiKey'),
		fieldModelId: t('vision.panel.field.modelId'),
		fieldCustomHeaders: t('vision.panel.field.customHeaders'),
		fieldExtraBody: t('vision.panel.field.extraBody'),
		hintCustomHeaders: t('vision.panel.hint.customHeaders'),
		hintExtraBody: t('vision.panel.hint.extraBody'),
		placeholderOpenAIEndpoint: t('vision.panel.placeholder.openaiEndpoint'),
		placeholderOpenAIResponsesEndpoint: t('vision.panel.placeholder.openaiResponsesEndpoint'),
		placeholderAnthropicEndpoint: t('vision.panel.placeholder.anthropicEndpoint'),
		placeholderEndpointType: t('vision.panel.placeholder.endpointType'),
		placeholderEnterApiKey: t('vision.panel.placeholder.enterApiKey'),
		endpointTypeOpenAIChatCompletions: t('vision.panel.endpointType.openaiChatCompletions'),
		endpointTypeOpenAIResponses: t('vision.panel.endpointType.openaiResponses'),
		endpointTypeAnthropicMessages: t('vision.panel.endpointType.anthropicMessages'),
		hintEndpointTypeEmpty: t('vision.panel.hint.endpointTypeEmpty'),
		hintEndpointTypeInferred: t('vision.panel.hint.endpointTypeInferred'),
		hintEndpointTypeManual: t('vision.panel.hint.endpointTypeManual'),
		hintEndpointTypeSelected: t('vision.panel.hint.endpointTypeSelected'),
		hintApiKeySet: t('vision.panel.hint.apiKeySet'),
		hintApiKeyUnset: t('vision.panel.hint.apiKeyUnset'),
		statusVscodeLmSelected: t('vision.panel.status.vscodeLmSelected'),
		statusApiKeySet: t('vision.panel.status.apiKeySet'),
		statusApiKeyNotSet: t('vision.panel.status.apiKeyNotSet'),
		statusTesting: t('vision.panel.status.testing'),
		statusApiKeyCleared: t('vision.panel.status.apiKeyCleared'),
		summaryNoVSCodeVisionTitle: t('vision.panel.summary.noVSCodeVision.title'),
		summaryNoVSCodeVisionDetail: t('vision.panel.summary.noVSCodeVision.detail'),
		summaryVscodeLmTitle: t('vision.panel.summary.vscodeLm.title'),
		summaryVscodeLmDetail: t('vision.panel.summary.vscodeLm.detail'),
		summaryApiNotConfiguredTitle: t('vision.panel.summary.apiNotConfigured.title'),
		summaryApiNotConfiguredDetail: t('vision.panel.summary.apiNotConfigured.detail'),
		summaryApiEndpointTitle: t('vision.panel.summary.apiEndpoint.title'),
		summaryApiEndpointDetail: t('vision.panel.summary.apiEndpoint.detail'),
		summaryApiKeySet: t('vision.panel.summary.apiKeySet'),
		summaryApiKeyNotSet: t('vision.panel.summary.apiKeyNotSet'),
		actionSave: t('vision.panel.action.save'),
		actionTest: t('vision.panel.action.test'),
		actionViewDetails: t('error.action.viewDetails'),
		actionClearApiKey: t('vision.panel.action.clearApiKey'),
		testImage: t('vision.panel.test.image'),
		testResponse: t('vision.panel.test.response'),
		errorRequired: t('vision.panel.error.required'),
		errorInvalidJson: t('vision.panel.error.invalidJson'),
	};
}
