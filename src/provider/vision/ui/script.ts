export function getVisionProxyPanelScript(initialState: string, initialStrings: string): string {
	return `
		const vscode = acquireVsCodeApi();
		const initialState = ${initialState};
		const strings = ${initialStrings};
		const summary = document.getElementById('summary');
		const summaryTitle = document.getElementById('summaryTitle');
		const summaryDetail = document.getElementById('summaryDetail');
		const form = document.getElementById('form');
		const sourceField = document.getElementById('sourceField');
		const sourceInputs = Array.from(document.querySelectorAll('input[name="source"]'));
		const lmSection = document.getElementById('lmSection');
		const lmModelKey = document.getElementById('lmModelKey');
		const lmModelCost = document.getElementById('lmModelCost');
		const endpointSection = document.getElementById('endpointSection');
		const url = document.getElementById('url');
		const endpointType = document.getElementById('endpointType');
		const endpointTypeHint = document.getElementById('endpointTypeHint');
		const apiKey = document.getElementById('apiKey');
		const apiKeyHint = document.getElementById('apiKeyHint');
		const modelId = document.getElementById('modelId');
		const headers = document.getElementById('headers');
		const extraBody = document.getElementById('extraBody');
		const status = document.getElementById('status');
		const testResult = document.getElementById('testResult');
		const testImage = document.getElementById('testImage');
		const testResponse = document.getElementById('testResponse');
		const saveButton = document.getElementById('save');
		const testButton = document.getElementById('test');

		let currentState = initialState;
		let currentStatusKind = undefined;
		let latestTestId = 0;
		let activeTestId = undefined;

		function applyState(state) {
			currentState = state;
			const config = state.config || {};
			renderSummary(state);
			renderLmModels(state.lmModels || [], state.selectedLmModelKey);
			setSelectedSource((state.lmModels || []).length > 0 ? state.source : 'api-endpoint');
			url.value = config.url || '';
			endpointType.value = getEndpointTypeValue(config);
			syncEndpointPlaceholder();
			updateEndpointTypeHint();
			modelId.value = config.modelId || '';
			headers.value = config.headers ? JSON.stringify(config.headers, null, 2) : '';
			extraBody.value = config.extraBody ? JSON.stringify(config.extraBody, null, 2) : '';
			apiKey.value = '';
			apiKey.placeholder = state.hasApiKey ? '••••••••••••' : strings.placeholderEnterApiKey;
			renderApiKeyHint(state.hasApiKey);
			syncSourceVisibility();
			if (getSelectedSource() === 'vscode-lm') {
				setStatus(lmModelKey.value ? strings.statusVscodeLmSelected : '', false);
			} else {
				setStatus(state.hasApiKey ? strings.statusApiKeySet : strings.statusApiKeyNotSet, false);
			}
			clearTestResult();
		}

		function renderSummary(state) {
			const summaryState = getSummaryState(state);
			summary.classList.toggle('success', summaryState.tone === 'success');
			summary.classList.toggle('warning', summaryState.tone === 'warning');
			summary.classList.toggle('error', summaryState.tone === 'error');
			summaryTitle.textContent = summaryState.title;
			summaryDetail.textContent = summaryState.detail;
		}

		function getSummaryState(state) {
			const source = state.source || 'api-endpoint';
			if (source === 'vscode-lm') {
				const model = (state.lmModels || []).find((item) => item.key === state.selectedLmModelKey);
				if (!model) {
					return {
						tone: 'error',
						title: strings.summaryNoVSCodeVisionTitle,
						detail: strings.summaryNoVSCodeVisionDetail,
					};
				}
				return {
					tone: 'success',
					title: strings.summaryVscodeLmTitle,
					detail: formatString(strings.summaryVscodeLmDetail, model.id, model.vendor),
				};
			}

			const config = state.config || {};
			if (!config.url || !config.modelId) {
				return {
					tone: 'error',
					title: strings.summaryApiNotConfiguredTitle,
					detail: strings.summaryApiNotConfiguredDetail,
				};
			}

			return {
				tone: state.hasApiKey ? 'success' : 'warning',
				title: strings.summaryApiEndpointTitle,
				detail: formatString(
					strings.summaryApiEndpointDetail,
					config.modelId,
					formatEndpointType(getEndpointTypeValue(config)),
					formatHost(config.url),
					state.hasApiKey ? strings.summaryApiKeySet : strings.summaryApiKeyNotSet,
				),
			};
		}

		function formatString(template, ...args) {
			return template.replace(/\\{(\\d+)\\}/g, (match, index) => {
				return Object.prototype.hasOwnProperty.call(args, index) ? String(args[index]) : match;
			});
		}

		function formatEndpointType(value) {
			if (value === 'anthropic-messages') {
				return strings.endpointTypeAnthropicMessages;
			}
			if (value === 'openai-responses') {
				return strings.endpointTypeOpenAIResponses;
			}
			if (value === 'openai-chat-completions') {
				return strings.endpointTypeOpenAIChatCompletions;
			}
			return strings.placeholderEndpointType;
		}

		function formatHost(value) {
			try {
				return new URL(value).host || value;
			} catch {
				return value;
			}
		}

		function syncEndpointPlaceholder() {
			if (endpointType.value === 'anthropic-messages') {
				url.placeholder = strings.placeholderAnthropicEndpoint;
			} else if (endpointType.value === 'openai-responses') {
				url.placeholder = strings.placeholderOpenAIResponsesEndpoint;
			} else {
				url.placeholder = strings.placeholderOpenAIEndpoint;
			}
		}

		function getEndpointTypeValue(config) {
			if (!config || !config.providerFamily) {
				return '';
			}
			if (config.providerFamily === 'anthropic-compatible') {
				return 'anthropic-messages';
			}
			return config.apiType === 'responses'
				? 'openai-responses'
				: 'openai-chat-completions';
		}

		function getEndpointTypeConfig(value) {
			if (value === 'anthropic-messages') {
				return { providerFamily: 'anthropic-compatible', apiType: 'messages' };
			}
			if (value === 'openai-responses') {
				return { providerFamily: 'openai-compatible', apiType: 'responses' };
			}
			if (value === 'openai-chat-completions') {
				return { providerFamily: 'openai-compatible', apiType: 'chat-completions' };
			}
			throw new Error(formatString(strings.errorRequired, strings.fieldEndpointType));
		}

		function inferEndpointType(value) {
			const path = getUrlPath(value).toLowerCase();
			if (!path) {
				return '';
			}
			if (path.includes('/responses')) {
				return 'openai-responses';
			}
			if (path.includes('/chat/completions')) {
				return 'openai-chat-completions';
			}
			if (path.includes('/messages')) {
				return 'anthropic-messages';
			}
			return '';
		}

		function getUrlPath(value) {
			const text = value.trim();
			if (!text) {
				return '';
			}
			try {
				return new URL(text).pathname;
			} catch {
				return text;
			}
		}

		function updateEndpointTypeFromUrl() {
			endpointType.value = inferEndpointType(url.value);
			syncEndpointPlaceholder();
			updateEndpointTypeHint();
		}

		function updateEndpointTypeHint() {
			if (!url.value.trim()) {
				endpointTypeHint.textContent = strings.hintEndpointTypeEmpty;
				return;
			}
			const inferred = inferEndpointType(url.value);
			if (inferred && endpointType.value === inferred) {
				endpointTypeHint.textContent = formatString(
					strings.hintEndpointTypeInferred,
					formatEndpointType(inferred),
				);
				return;
			}
			if (!endpointType.value) {
				endpointTypeHint.textContent = strings.hintEndpointTypeManual;
				return;
			}
			endpointTypeHint.textContent = formatString(
				strings.hintEndpointTypeSelected,
				formatEndpointType(endpointType.value),
			);
		}

		function renderLmModels(models, selectedKey) {
			lmModelKey.textContent = '';
			for (const model of models) {
				const option = document.createElement('option');
				option.value = model.key;
				option.textContent = model.label || model.id;
				option.title = [model.description || model.vendor || '', model.costDescription || '']
					.filter(Boolean)
					.join(' · ');
				if (model.key === selectedKey) {
					option.selected = true;
				}
				lmModelKey.appendChild(option);
			}
			if (!lmModelKey.value && models[0]) {
				lmModelKey.value = models[0].key;
			}
			updateLanguageModelCost();
		}

		function updateLanguageModelCost() {
			const model = (currentState.lmModels || []).find((item) => item.key === lmModelKey.value);
			const costDescription = model ? model.costDescription || '' : '';
			lmModelCost.textContent = costDescription;
			lmModelCost.hidden = !costDescription;
		}

		function getSelectedSource() {
			const selected = sourceInputs.find((input) => input.checked);
			return selected ? selected.value : 'api-endpoint';
		}

		function setSelectedSource(value) {
			const selectedValue = value === 'vscode-lm' ? 'vscode-lm' : 'api-endpoint';
			for (const input of sourceInputs) {
				input.checked = input.value === selectedValue;
			}
		}

		function syncSourceVisibility() {
			const hasLmModels = (currentState.lmModels || []).length > 0;
			const source = hasLmModels ? getSelectedSource() : 'api-endpoint';
			sourceField.hidden = !hasLmModels;
			lmSection.hidden = !hasLmModels || source !== 'vscode-lm';
			endpointSection.hidden = source !== 'api-endpoint';
			testButton.hidden = source !== 'api-endpoint';
			saveButton.textContent = strings.actionSave;
		}

		function collectConfig() {
			const parsedHeaders = parseOptionalJson(headers.value, strings.fieldCustomHeaders);
			const parsedExtraBody = parseOptionalJson(extraBody.value, strings.fieldExtraBody);
			const endpointConfig = getEndpointTypeConfig(endpointType.value);
			return {
				providerFamily: endpointConfig.providerFamily,
				apiType: endpointConfig.apiType,
				url: url.value,
				modelId: modelId.value,
				headers: parsedHeaders,
				extraBody: parsedExtraBody,
				updatedAt: Date.now(),
			};
		}

		function parseOptionalJson(value, label) {
			const text = value.trim();
			if (!text) {
				return undefined;
			}
			try {
				return JSON.parse(text);
			} catch {
				throw new Error(formatString(strings.errorInvalidJson, label));
			}
		}

		function collectPayload() {
			const source = getSelectedSource();
			if (source === 'vscode-lm') {
				return {
					source,
					lmModelKey: lmModelKey.value,
				};
			}
			return {
				source,
				config: collectConfig(),
				apiKey: apiKey.value,
			};
		}

		function post(type, value) {
			try {
				vscode.postMessage({ type, value });
			} catch (error) {
				setStatus(error instanceof Error ? error.message : String(error), true);
			}
		}

		function postConfig(type) {
			const testId = type === 'testConnection' ? startTestStatus() : undefined;
			try {
				const payload = collectPayload();
				post(type, testId ? { ...payload, testId } : payload);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (type === 'testConnection') {
					setStatus(formatUnknownErrorMessage(message), true, false, createShowLogsAction(), 'test');
					post('logVisionProxyTestFailure', { message });
				} else {
					setStatus(message, true);
				}
			}
		}

		function startTestStatus() {
			const testId = ++latestTestId;
			activeTestId = testId;
			clearTestResult();
			return testId;
		}

		function invalidateTestStatus() {
			activeTestId = undefined;
			clearTestResult();
			if (currentStatusKind === 'test') {
				setStatus('', false);
			}
		}

		function setStatus(message, isError, isSuccess, action, kind) {
			currentStatusKind = message ? kind || 'default' : undefined;
			status.textContent = '';
			if (message) {
				status.appendChild(document.createTextNode(message));
			}
			if (action && action.command === 'showLogs') {
				if (message) {
					status.appendChild(document.createTextNode(' · '));
				}
				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'status-link';
				button.textContent = action.label;
				button.addEventListener('click', () => post('showLogs'));
				status.appendChild(button);
			}
			status.classList.toggle('error', Boolean(isError));
			status.classList.toggle('success', Boolean(isSuccess));
		}

		function setTestResult(value) {
			if (!value || !value.imageDataUrl || !value.response) {
				clearTestResult();
				return;
			}
			testImage.src = value.imageDataUrl;
			testResponse.textContent = value.response;
			testResult.hidden = false;
		}

		function clearTestResult() {
			testImage.removeAttribute('src');
			testResponse.textContent = '';
			testResult.hidden = true;
		}

		function renderApiKeyHint(hasApiKey) {
			apiKeyHint.textContent = '';
			if (!hasApiKey) {
				apiKeyHint.textContent = strings.hintApiKeyUnset;
				return;
			}
			apiKeyHint.appendChild(document.createTextNode(strings.hintApiKeySet + ' '));
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'hint-link';
			button.textContent = strings.actionClearApiKey;
			button.addEventListener('click', () => {
				invalidateTestStatus();
				post('clearApiKey');
			});
			apiKeyHint.appendChild(button);
		}

		function applyApiKeyCleared(message) {
			currentState = { ...currentState, hasApiKey: false };
			apiKey.value = '';
			apiKey.placeholder = strings.placeholderEnterApiKey;
			renderApiKeyHint(false);
			renderSummary(currentState);
			setStatus(message || strings.statusApiKeyCleared, false);
		}

		function createShowLogsAction() {
			return { command: 'showLogs', label: strings.actionViewDetails };
		}

		function formatUnknownErrorMessage(message) {
			return /^\\[[^\\]]+\\]\\s/.test(message) ? message : '[UNKNOWN] ' + message;
		}

		form.addEventListener('submit', (event) => {
			event.preventDefault();
			postConfig('saveConfig');
		});
		for (const input of sourceInputs) {
			input.addEventListener('change', () => {
				invalidateTestStatus();
				syncSourceVisibility();
				setStatus('', false);
			});
		}
		lmModelKey.addEventListener('change', () => {
			invalidateTestStatus();
			updateLanguageModelCost();
			setStatus(lmModelKey.value ? strings.statusVscodeLmSelected : '', false);
		});
		url.addEventListener('input', () => {
			invalidateTestStatus();
			updateEndpointTypeFromUrl();
		});
		for (const field of [apiKey, modelId, headers, extraBody]) {
			field.addEventListener('input', invalidateTestStatus);
		}
		endpointType.addEventListener('change', () => {
			syncEndpointPlaceholder();
			updateEndpointTypeHint();
			invalidateTestStatus();
		});
		testButton.addEventListener('click', () => {
			setStatus(strings.statusTesting, false, false, undefined, 'test');
			postConfig('testConnection');
		});
		window.addEventListener('message', (event) => {
			const message = event.data;
			if (message.type === 'state') {
				applyState(message.value);
			} else if (message.type === 'apiKeyCleared') {
				applyApiKeyCleared(message.value && message.value.message);
			} else if (message.type === 'status') {
				if (
					message.value.kind === 'test' &&
					(!activeTestId || message.value.testId !== activeTestId)
				) {
					return;
				}
				setStatus(
					message.value.message,
					message.value.error,
					message.value.success,
					message.value.action,
					message.value.kind,
				);
				setTestResult(message.value.testResult);
			}
		});

		applyState(initialState);
	`;
}
