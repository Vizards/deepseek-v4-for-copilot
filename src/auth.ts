import * as vscode from 'vscode';

const API_KEY_SECRET = 'deepseek-copilot.apiKey';

/**
 * Manages DeepSeek API key via VS Code SecretStorage (secure) with
 * fallback to extension settings (less secure, for CI/automation).
 */
export class AuthManager {
	private readonly secretStorage: vscode.SecretStorage;

	constructor(context: vscode.ExtensionContext) {
		this.secretStorage = context.secrets;
	}

	/**
	 * Get API key. Tries SecretStorage first, then falls back to settings.
	 */
	async getApiKey(): Promise<string | undefined> {
		const secretKey = await this.secretStorage.get(API_KEY_SECRET);
		if (secretKey) {
			return secretKey;
		}

		const config = vscode.workspace.getConfiguration('deepseek-copilot');
		const settingsKey = config.get<string>('apiKey');
		if (settingsKey?.trim()) {
			return settingsKey.trim();
		}

		return undefined;
	}

	/**
	 * Store API key in SecretStorage.
	 */
	async setApiKey(apiKey: string): Promise<void> {
		await this.secretStorage.store(API_KEY_SECRET, apiKey.trim());
	}

	/**
	 * Delete stored API key.
	 */
	async deleteApiKey(): Promise<void> {
		await this.secretStorage.delete(API_KEY_SECRET);
	}

	/**
	 * Check if an API key is configured.
	 */
	async hasApiKey(): Promise<boolean> {
		const key = await this.getApiKey();
		return key !== undefined && key.length > 0;
	}

	/**
	 * Prompt user to enter API key via input box.
	 */
	async promptForApiKey(): Promise<boolean> {
		const apiKey = await vscode.window.showInputBox({
			prompt: 'Enter your DeepSeek API key',
			placeHolder: 'sk-...',
			password: true,
			ignoreFocusOut: true,
			validateInput: (value: string) => {
				if (!value?.trim()) {
					return 'API key cannot be empty';
				}
				if (!value.startsWith('sk-')) {
					return 'API key should start with "sk-"';
				}
				return undefined;
			},
		});

		if (apiKey) {
			await this.setApiKey(apiKey);
			vscode.window.showInformationMessage('DeepSeek API key saved securely.');
			return true;
		}

		return false;
	}

	/**
	 * Get base URL from settings.
	 */
	getBaseUrl(): string {
		const config = vscode.workspace.getConfiguration('deepseek-copilot');
		return config.get<string>('baseUrl') || 'https://api.deepseek.com';
	}

	/**
	 * Resolve the API model ID to send to the DeepSeek endpoint.
	 * Users can override the default IDs via settings to support compatible APIs.
	 */
	getApiModelId(vscodeModelId: string): string {
		const config = vscode.workspace.getConfiguration('deepseek-copilot');
		if (vscodeModelId === 'deepseek-v4-flash') {
			return config.get<string>('flashModelId')?.trim() || 'deepseek-v4-flash';
		}
		if (vscodeModelId === 'deepseek-v4-pro') {
			return config.get<string>('proModelId')?.trim() || 'deepseek-v4-pro';
		}
		return vscodeModelId;
	}

	/**
	 * Get max tokens limit (0 = no limit).
	 */
	getMaxTokens(): number | undefined {
		const config = vscode.workspace.getConfiguration('deepseek-copilot');
		const value = config.get<number>('maxTokens', 0);
		return value > 0 ? value : undefined;
	}
}
