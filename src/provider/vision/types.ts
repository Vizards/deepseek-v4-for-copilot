import type vscode from 'vscode';
import type { ReplayMarkerMetadata } from '../replay';
import type { VisionInputMimeStats } from './normalize';

export type VisionProxySource = 'api-endpoint' | 'vscode-lm';

export type VisionProxyProviderFamily = 'anthropic-compatible' | 'openai-compatible';

export type VisionProxyApiType = 'messages' | 'chat-completions' | 'responses';

export interface VisionLanguageModelOption {
	key: string;
	id: string;
	vendor: string;
	name: string;
	family: string;
	version: string;
	label: string;
	description: string;
	costDescription?: string;
}

export interface VisionProxyConfig {
	providerFamily: VisionProxyProviderFamily;
	apiType: VisionProxyApiType;
	url: string;
	modelId: string;
	timeoutMs?: number;
	headers?: Record<string, string>;
	extraBody?: Record<string, unknown>;
	updatedAt: number;
}

export interface VisionImagePart {
	mimeType: string;
	data: Uint8Array;
}

export interface VisionDescriptionRequest {
	prompt: string;
	images: readonly VisionImagePart[];
	token: vscode.CancellationToken;
}

export interface VisionDescriber {
	readonly id: string;
	readonly source: VisionProxySource;
	describe(request: VisionDescriptionRequest): Promise<string>;
}

export interface VisionResolutionInputStats {
	// Actual top-level user image data parts only; nested tool images are excluded.
	imageParts: number;
	imageMessages: number;
	// Sum of raw input image bytes from VS Code data parts.
	imageBytes: number;
	imageMimes: VisionInputMimeStats[];
	// Counts successfully carried through the selected native/proxy route, or unresolved/omitted.
	forwardedImageParts: number;
	droppedImageParts: number;
}

export interface VisionResolutionToolStats {
	// Actual nested tool-result image data parts only; top-level user images are excluded.
	imageParts: number;
	imageBytes: number;
	imageMimes: VisionInputMimeStats[];
	resultsWithImages: number;
	forwardedImageParts: number;
	droppedImageParts: number;
}

export interface VisionResolutionStats {
	// none: no image input in this request
	// proxy: image parts are resolved through the vision proxy pipeline
	// native: image parts are forwarded directly to a native-image model
	imageHandlingMode: 'none' | 'proxy' | 'native';
	input: VisionResolutionInputStats;
	tool: VisionResolutionToolStats;
	currentImageMessages: number;
	generatedImageMessages: number;
	replayedImageMessages: number;
	omittedImageMessages: number;
	unavailableImageMessages: number;
	failedImageMessages: number;
	markerVisionTextChars: number;
	invalidMarkerVisionMetadata: number;
}

export interface VisionResolutionResult {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	stats: VisionResolutionStats;
	replayMarkerMetadata: ReplayMarkerMetadata;
	visionModelId?: string;
	visionProxySource?: VisionProxySource;
	initialResponseNotice?: string;
}
