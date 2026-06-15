import vscode from 'vscode';
import { t } from '../../../../i18n';
import { logVisionProxyTestFailed, logVisionProxyTestSucceeded } from '../../log';
import { VisionProxyClient } from '../../protocols/client';
import { getVisionProxyErrorDisplayCode, isVisionProxyError } from '../../protocols/errors';
import type { VisionProxyConfig } from '../../types';

export interface VisionProxyTestResult {
	ok: boolean;
	errorCode?: string;
	imageDataUrl?: string;
	message?: string;
	response?: string;
}

const TEST_PROMPT =
	'This is a vision capability test. Read the 4-character code in the attached image and return only the code.';

// Small captcha-style RGBA PNG with a 4-character code. The user reviews the response.
const TEST_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAHgAAAAwCAYAAADab77TAAAA7ElEQVR42u3bwRGDIBBAUYuw/1IshTq4JWMHgivg+g4/t5iEFwiDk+04jp/ytp0PtVYlDDBgARZgARZgARZgwBfb972p6Ou1vl7r+7n7/OjxAQwYMGDA3wUePUDR178L9MbxAQwYMGDAgJ/4ANEAIzY9gAEDBgwYcARw9EHE6C9YRlDAgAEDBvwN4NmbotkHISuCAk4CXEoBvDrwidSbGfwgcC+KJXowcCtI6+yZvYl7HfCdJa1nBq1+92x54NFLGuCHZ9Tqv8GAk2+yojdpow+CAAMGDBhwXmD5d6EAC7AAC7AAAxZgvQJYefsD61pUdJBmqecAAAAASUVORK5CYII=';
const TEST_IMAGE_DATA_URL = `data:image/png;base64,${TEST_PNG_BASE64}`;

export async function testVisionProxyConnection(
	config: VisionProxyConfig,
	apiKey: string | undefined,
): Promise<VisionProxyTestResult> {
	const tokenSource = new vscode.CancellationTokenSource();
	try {
		const description = await new VisionProxyClient().describe(config, apiKey, {
			prompt: TEST_PROMPT,
			images: [
				{
					mimeType: 'image/png',
					data: Buffer.from(TEST_PNG_BASE64, 'base64'),
				},
			],
			token: tokenSource.token,
		});
		logVisionProxyTestSucceeded(config, apiKey, description);
		return { ok: true, imageDataUrl: TEST_IMAGE_DATA_URL, response: description };
	} catch (error) {
		logVisionProxyTestFailed(error);
		if (isVisionProxyError(error)) {
			return {
				ok: false,
				errorCode: getVisionProxyErrorDisplayCode(error),
				message: error.message,
			};
		}
		return {
			ok: false,
			errorCode: getVisionProxyErrorDisplayCode(error),
			message: error instanceof Error ? error.message : t('vision.proxy.error.testFailed'),
		};
	} finally {
		tokenSource.dispose();
	}
}
