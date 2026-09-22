import vscode from 'vscode';
import { t } from '../../i18n';
import { toWellFormedString } from '../../json';
import { createVisionProxyFailureNotice, createVisionProxyMissingNotice } from '../tools/notices';
import {
	IMAGE_DESCRIPTION_PREFIX,
	IMAGE_DESCRIPTION_SUFFIX,
	IMAGE_DESCRIPTION_UNAVAILABLE,
} from './consts';
import { logVisionProxyDescribeFailed, logVisionProxyUnavailable } from './log';
import {
	formatVisionProxyErrorCode,
	getVisionProxyErrorDisplayCode,
	isVisionProxyError,
} from './protocols/errors';
import { getVisionPrompt } from './sources/vscode';
import type {
	VisionDescriber,
	VisionImagePart,
	VisionProxySource,
	VisionResolutionStats,
} from './types';

export interface VisionDescriptionSessionMetadata {
	visionModelId?: string;
	visionProxySource?: VisionProxySource;
	initialResponseNotice?: string;
}

export interface VisionDescriptionSession {
	describe(images: readonly VisionImagePart[], owner: 'input' | 'tool'): Promise<string>;
	getMetadata(): VisionDescriptionSessionMetadata;
}

/** Create one lazy describer session shared by every image route in a provider request. */
export function createVisionDescriptionSession(
	stats: VisionResolutionStats,
	token: vscode.CancellationToken,
	getDescriber: () => Promise<VisionDescriber | undefined>,
): VisionDescriptionSession {
	let describerPromise: Promise<VisionDescriber | undefined> | undefined;
	let describer: VisionDescriber | undefined;
	let missingVisionProxy = false;
	let failureNotice: string | undefined;

	const resolveDescriber = async (): Promise<VisionDescriber | undefined> => {
		if (token.isCancellationRequested) {
			return undefined;
		}
		describerPromise ??= getDescriber();
		describer = await describerPromise;
		if (!describer && !token.isCancellationRequested && !missingVisionProxy) {
			missingVisionProxy = true;
			logVisionProxyUnavailable();
		}
		return describer;
	};

	return {
		async describe(images, owner): Promise<string> {
			const currentDescriber = await resolveDescriber();
			if (!currentDescriber || token.isCancellationRequested) {
				stats.unavailableImageMessages += 1;
				recordImageOutcome(stats, owner, images.length, 'dropped');
				return IMAGE_DESCRIPTION_UNAVAILABLE;
			}

			try {
				const description = await currentDescriber.describe({
					prompt: getVisionPrompt(),
					images,
					token,
				});
				if (description.length === 0) {
					stats.failedImageMessages += 1;
					recordImageOutcome(stats, owner, images.length, 'dropped');
					failureNotice ??= createVisionProxyFailureNotice(
						formatVisionProxyErrorCode('empty-response'),
						t('vision.proxy.error.emptyResponse'),
					);
					return IMAGE_DESCRIPTION_UNAVAILABLE;
				}

				stats.generatedImageMessages += 1;
				recordImageOutcome(stats, owner, images.length, 'forwarded');
				return toWellFormedString(
					IMAGE_DESCRIPTION_PREFIX + description + IMAGE_DESCRIPTION_SUFFIX,
				);
			} catch (error) {
				if (isCancellation(error, token)) {
					stats.unavailableImageMessages += 1;
					recordImageOutcome(stats, owner, images.length, 'dropped');
					return IMAGE_DESCRIPTION_UNAVAILABLE;
				}
				logVisionProxyDescribeFailed(error);
				stats.failedImageMessages += 1;
				recordImageOutcome(stats, owner, images.length, 'dropped');
				failureNotice ??= createVisionProxyFailureNotice(
					getVisionProxyErrorDisplayCode(error),
					formatVisionProxyErrorMessage(error),
				);
				return IMAGE_DESCRIPTION_UNAVAILABLE;
			}
		},

		getMetadata(): VisionDescriptionSessionMetadata {
			return {
				visionModelId: describer?.id,
				visionProxySource: describer?.source,
				initialResponseNotice: missingVisionProxy
					? createVisionProxyMissingNotice()
					: failureNotice,
			};
		},
	};
}

function recordImageOutcome(
	stats: VisionResolutionStats,
	owner: 'input' | 'tool',
	imageParts: number,
	outcome: 'forwarded' | 'dropped',
): void {
	const field = outcome === 'forwarded' ? 'forwardedImageParts' : 'droppedImageParts';
	stats[owner][field] += imageParts;
}

function isCancellation(error: unknown, token: vscode.CancellationToken): boolean {
	return token.isCancellationRequested || (isVisionProxyError(error) && error.code === 'cancelled');
}

function formatVisionProxyErrorMessage(error: unknown): string {
	if (isVisionProxyError(error)) {
		return error.message;
	}
	return t('vision.proxy.error.requestFailed', t('vision.proxy.error.unknown'));
}
