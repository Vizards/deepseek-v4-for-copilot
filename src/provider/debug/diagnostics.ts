import { createHash } from 'crypto';
import vscode from 'vscode';
import { getDebugLoggingEnabled } from '../../config';
import { LANGUAGE_MODEL_CHAT_SYSTEM_ROLE } from '../../consts';
import { logger } from '../../logger';
import type { DeepSeekMessage, DeepSeekRequest, DeepSeekTool, DeepSeekUsage } from '../../types';
import {
	classifyDeepSeekRequest,
	formatModelFields,
	formatRequestLogLine,
	type RequestKind,
} from '../routing';
import { REPLAY_MARKER_MIME, parseFirstReplayMarker } from '../replay';
import type { ConversationSegment } from '../segment';
import { ACTIVATE_TOOL_PREFIX } from '../tools/consts';
import type { ActivatePreflightInspection } from '../tools/preflight';
import { IMAGE_DESCRIPTION_UNAVAILABLE } from '../vision/consts';
import type { VisionProxySource, VisionResolutionStats as VisionPipelineStats } from '../vision';

const LARGE_MESSAGE_CHARS = 10_000;
const HASH_WINDOW_CHARS = 2_048;
const HOST_CACHE_CONTROL_MIME = 'cache_control';
const SYSTEM_PROMPT_SECTION_MAX_LINES = 40;
const SAFE_SYSTEM_PROMPT_TAGS = new Set([
	'agents',
	'attachments',
	'customizationsUpdate',
	'instruction',
	'instructions',
	'skill',
	'skills',
	'toolUseInstructions',
]);

export interface CacheTraceStats {
	messageCount: number;
	userMessages: number;
	assistantMessages: number;
	toolMessages: number;
	systemMessages: number;
	toolCount: number;
	totalContentChars: number;
	toolCallArgumentChars: number;
	reasoningChars: number;
	largeMessages: number;
	assistantToolCallMessages: number;
	nonEmptyToolReasoningMessages: number;
	emptyToolReasoningMessages: number;
	missingToolReasoningMessages: number;
	assistantAfterToolResultMessages: number;
	assistantAfterToolResultToolCallMessages: number;
	assistantAfterToolResultFinalMessages: number;
	nonEmptyPostToolReasoningMessages: number;
	emptyPostToolReasoningMessages: number;
	missingPostToolReasoningMessages: number;
	nonEmptyPostToolCallReasoningMessages: number;
	emptyPostToolCallReasoningMessages: number;
	missingPostToolCallReasoningMessages: number;
	nonEmptyPostToolFinalReasoningMessages: number;
	emptyPostToolFinalReasoningMessages: number;
	missingPostToolFinalReasoningMessages: number;
	imageDescriptionMessages: number;
	imageDescriptionParts: number;
	unableImageMessages: number;
	urlMessages: number;
	urlCount: number;
	codeFenceMessages: number;
	codeFenceCount: number;
	likelyPathMessages: number;
	likelyPathCount: number;
}

export interface CacheTraceMessageSummary {
	index: number;
	role: DeepSeekMessage['role'];
	hash: string;
	contentHash: string;
	contentHeadHash: string;
	contentTailHash: string;
	contentChars: number;
	contentLines: number;
	imageDescriptionCount: number;
	unableImageCount: number;
	urlCount: number;
	codeFenceCount: number;
	likelyPathCount: number;
	toolCalls: number;
	toolCallArgumentChars: number;
	reasoningChars: number;
	emptyReasoning: boolean;
	missingToolReasoning: boolean;
	followsToolResult: boolean;
	afterToolResultKind: 'none' | 'tool-call' | 'final';
	missingPostToolReasoning: boolean;
	missingPostToolCallReasoning: boolean;
	missingPostToolFinalReasoning: boolean;
	contentSections?: CacheTraceContentSectionSummary[];
}

export interface CacheTraceToolSummary {
	index: number;
	name: string;
	hash: string;
	descriptionHash: string;
	parametersHash: string;
}

export interface CacheTraceContentSectionSummary {
	index: number;
	label: string;
	startLine: number;
	endLine: number;
	startChar: number;
	endChar: number;
	chars: number;
	hash: string;
}

export interface CacheTraceSnapshot {
	fingerprint: string;
	requestKind: RequestKind;
	model: string;
	cacheTraceKey: string;
	redactedComparisonInput: string;
	requiresReasoningContent: boolean;
	inputAssistantSummaries: CacheTraceInputAssistantSummary[];
	toolsHash: string;
	toolSummaries: CacheTraceToolSummary[];
	messageSummaries: CacheTraceMessageSummary[];
	stats: CacheTraceStats;
}

export interface CacheTraceInputAssistantSummary {
	index: number;
	textChars: number;
	toolCalls: number;
	thinkingChars: number;
	replayMarkerParts: number;
	replayMarkerReasoningChars: number;
	replayMarkerInvalid: boolean;
}

export interface CacheTraceComparison {
	commonPrefixSummaryChars: number;
	commonPrefixSummaryPercent: number;
	previousMessageCount: number;
	currentMessageCount: number;
	firstChangedMessageIndex: number | undefined;
	previousMessage: CacheTraceMessageSummary | undefined;
	currentMessage: CacheTraceMessageSummary | undefined;
	toolsChanged: boolean;
	previousToolsHash: string;
	currentToolsHash: string;
	firstChangedToolIndex: number | undefined;
	previousTool: CacheTraceToolSummary | undefined;
	currentTool: CacheTraceToolSummary | undefined;
	systemPromptChange: CacheTraceSystemPromptChange | undefined;
}

export interface CacheTraceSystemPromptChange {
	firstChangedSectionIndex: number | undefined;
	previousSection: CacheTraceContentSectionSummary | undefined;
	currentSection: CacheTraceContentSectionSummary | undefined;
}

export interface BeginCacheDiagnosticsOptions {
	request: DeepSeekRequest;
	segment: ConversationSegment;
	requestKind?: RequestKind;
	vscodeModelId: string;
	isThinkingModel: boolean;
	thinkingEffort: string;
	maxTokens: number | undefined;
	inputMessages: readonly vscode.LanguageModelChatRequestMessage[];
	resolvedMessages: readonly vscode.LanguageModelChatRequestMessage[];
	visionModelId?: string;
	visionProxySource?: VisionProxySource;
	visionStats?: VisionPipelineStats;
}

export interface CacheDiagnosticsDoneInfo {
	reasoningTextChars: number;
	emittedToolCalls: number;
	trailingToolResults: number;
}

export interface CacheDiagnosticsRun {
	onDone(info: CacheDiagnosticsDoneInfo): void;
	onCancellationTokenRequested(): void;
	onReplayMarkerReport(info: ReplayMarkerReportInfo): void;
	onUsage(usage: DeepSeekUsage, charsPerToken: number): void;
}

export type ReplayMarkerReportStatus = 'reported' | 'failed' | 'skipped';

export type ReplayMarkerReportTrigger = 'done';

export interface ReplayMarkerReportInfo {
	status: ReplayMarkerReportStatus;
	trigger?: ReplayMarkerReportTrigger;
	markerBytes?: number;
	visionTextChars?: number;
	reasoningTextChars?: number;
	reason?: 'cancelled' | 'stream-error' | 'no-replay-data';
	error?: unknown;
}

export function observeCancellationToken(
	token: vscode.CancellationToken,
	diagnosticsRun: CacheDiagnosticsRun,
	onCancellationRequested?: () => void,
): vscode.Disposable {
	let notified = false;
	const notifyCancellationRequested = (): void => {
		if (notified) {
			return;
		}
		notified = true;
		diagnosticsRun.onCancellationTokenRequested();
		onCancellationRequested?.();
	};
	const listener = token.onCancellationRequested(notifyCancellationRequested);
	if (token.isCancellationRequested) {
		notifyCancellationRequested();
	}
	return listener;
}

export interface CacheDiagnosticsRecorder {
	isEnabled(): boolean;
	beginRequest(options: BeginCacheDiagnosticsOptions): CacheDiagnosticsRun;
}

export function createCacheDiagnosticsRecorder(): CacheDiagnosticsRecorder {
	return new DefaultCacheDiagnosticsRecorder();
}

export function logToolFlowDiagnostics({
	requestKind,
	tools,
	messagesFiltered,
	preflight,
	activatePreflight,
	nextRound,
	initialResponseNotice,
}: {
	requestKind: RequestKind;
	tools: readonly vscode.LanguageModelChatTool[] | undefined;
	messagesFiltered: boolean;
	preflight: 'skipped' | 'handled' | 'ready' | 'round-limit';
	activatePreflight?: ActivatePreflightInspection;
	nextRound?: number;
	initialResponseNotice?: boolean;
}): void {
	if (!getDebugLoggingEnabled()) {
		return;
	}

	const activateToolCount =
		tools?.reduce(
			(count, tool) => count + (tool.name.startsWith(ACTIVATE_TOOL_PREFIX) ? 1 : 0),
			0,
		) ?? 0;
	if (preflight === 'skipped' && !messagesFiltered && activateToolCount === 0) {
		return;
	}

	let message =
		`[tool-flow] preflight=${preflight}` +
		` tools=${tools?.length ?? 0}` +
		` activateTools=${activateToolCount}`;
	if (messagesFiltered) {
		message += ` messagesFiltered=true`;
	}
	if (activatePreflight) {
		message +=
			` preflightRounds=${activatePreflight.rounds}` +
			` calledActivators=${activatePreflight.calledActivatorNames.length}` +
			` remainingActivators=${activatePreflight.remainingActivatorNames.length}`;
	}
	if (nextRound !== undefined) {
		message += ` nextRound=${nextRound}`;
	}
	if (initialResponseNotice) {
		message += ` initialResponseNotice=true`;
	}

	logger.info(formatRequestLogLine(requestKind, message));
}

interface VisionMessageStats {
	inputImageParts: number;
	inputImageMessages: number;
	describedImageMessages: number;
	failedImageMessages: number;
	droppedImageParts: number;
	historyDescriptionMessages: number;
	visionModelId?: string;
	visionProxySource?: VisionProxySource;
}

interface HostPromptTrace {
	hostFreezeCustomizationsIndex: boolean | 'unknown';
	systemMessageIndex: number | null;
	systemRole: string | null;
	systemChars: number;
	systemLines: number;
	systemHash: string | null;
	hasSkillsTag: boolean;
	hasAgentsTag: boolean;
	skillTagCount: number;
	agentTagCount: number;
	customizationsUpdateCount: number;
	latestUserMessageIndex: number | null;
	latestUserHasCustomizationsUpdate: boolean;
}

interface UsageLogContext {
	vscodeModelId: string;
	apiModelId: string;
	requestKind: RequestKind;
}

class DefaultCacheDiagnosticsRecorder implements CacheDiagnosticsRecorder {
	private readonly previousCacheTraces = new Map<string, CacheTraceSnapshot>();
	private readonly lastCacheTracesByScope = new Map<string, CacheTraceSnapshot>();
	private lastCacheTrace: CacheTraceSnapshot | undefined;
	private requestId = 0;

	isEnabled(): boolean {
		return getDebugLoggingEnabled();
	}

	beginRequest(options: BeginCacheDiagnosticsOptions): CacheDiagnosticsRun {
		const requestKind =
			options.requestKind ??
			classifyDeepSeekRequest({
				request: options.request,
				inputMessages: options.inputMessages,
			});

		if (!this.isEnabled()) {
			this.clearCacheTraces();
			return new NoopCacheDiagnosticsRun({
				vscodeModelId: options.vscodeModelId,
				apiModelId: options.request.model,
				requestKind,
			});
		}

		const requestId = (this.requestId += 1);
		const cacheTrace = createCacheTraceSnapshot(
			options.request,
			options.inputMessages,
			requestKind,
		);
		const previousCacheTrace = this.previousCacheTraces.get(getCacheTraceStoreKey(cacheTrace));
		const previousImmediateCacheTrace = this.lastCacheTrace;
		const previousScopedCacheTrace = this.lastCacheTracesByScope.get(
			getCacheTraceScopeKey(cacheTrace),
		);
		const cacheTraceComparison = compareCacheTraceSnapshots(previousCacheTrace, cacheTrace);
		const immediateTraceKeyChanged =
			previousImmediateCacheTrace?.cacheTraceKey !== undefined &&
			previousImmediateCacheTrace.cacheTraceKey !== cacheTrace.cacheTraceKey;
		const sameImmediateComparisonScope =
			previousImmediateCacheTrace !== undefined &&
			previousImmediateCacheTrace.requestKind === cacheTrace.requestKind &&
			previousImmediateCacheTrace.model === cacheTrace.model &&
			previousImmediateCacheTrace.toolsHash === cacheTrace.toolsHash;
		const traceKeyChangeComparison =
			previousImmediateCacheTrace && immediateTraceKeyChanged && sameImmediateComparisonScope
				? compareCacheTraceSnapshots(previousImmediateCacheTrace, cacheTrace)
				: undefined;
		const skippedImmediateFallback =
			previousImmediateCacheTrace && immediateTraceKeyChanged && !sameImmediateComparisonScope
				? previousImmediateCacheTrace
				: undefined;
		const scopedTraceKeyChangeComparison =
			!traceKeyChangeComparison &&
			previousScopedCacheTrace &&
			previousScopedCacheTrace !== previousImmediateCacheTrace &&
			previousScopedCacheTrace.cacheTraceKey !== cacheTrace.cacheTraceKey
				? compareCacheTraceSnapshots(previousScopedCacheTrace, cacheTrace)
				: undefined;
		const visionResolution = summarizeVisionResolution(
			options.inputMessages,
			options.resolvedMessages,
			options.visionModelId,
			options.visionProxySource,
		);

		logger.info(
			formatRequestLogLine(
				requestKind,
				`[cache-trace #${requestId}] ${formatCacheTraceSnapshot(cacheTrace)}`,
			),
		);
		logger.info(
			formatRequestLogLine(
				requestKind,
				`[cache-trace #${requestId}] request ` +
					formatModelFields(options.vscodeModelId, options.request.model) +
					formatSegmentTrace(options.segment) +
					` thinking=${options.isThinkingModel}` +
					` thinkingEffort=${options.thinkingEffort}` +
					` maxTokens=${options.maxTokens ?? 'api-default'}` +
					` inputMessages=${options.inputMessages.length}` +
					` deepseekMessages=${options.request.messages.length}`,
			),
		);
		const hostPromptTrace = summarizeHostPromptTrace(options.inputMessages);
		if (shouldLogHostPromptTrace(hostPromptTrace)) {
			logger.info(
				formatRequestLogLine(
					requestKind,
					`[cache-trace #${requestId}] ${formatHostPromptTrace(hostPromptTrace)}`,
				),
			);
		}
		const vscodeMessageTrace = formatVscodeMessageTrace(options.inputMessages);
		if (vscodeMessageTrace) {
			logger.debug(
				formatRequestLogLine(
					requestKind,
					`[cache-trace #${requestId}] vscodeMsgs ${vscodeMessageTrace}`,
				),
			);
		}
		for (const detailLine of formatCacheTraceDetailLines(cacheTrace)) {
			const message = formatRequestLogLine(
				requestKind,
				`[cache-trace #${requestId}] ${detailLine}`,
			);
			if (detailLine.startsWith('contentMarkers ')) {
				logger.debug(message);
			} else {
				logger.info(message);
			}
		}
		const visionTrace = formatVisionTrace(visionResolution, options.visionStats);
		if (visionTrace) {
			logger.info(formatRequestLogLine(requestKind, `[cache-trace #${requestId}] ${visionTrace}`));
		}
		if (cacheTraceComparison) {
			logger.info(
				formatRequestLogLine(
					requestKind,
					`[cache-trace #${requestId}] ${formatCacheTraceComparison(cacheTraceComparison)}`,
				),
			);
			for (const detailLine of formatCacheTraceComparisonDetailLines(cacheTraceComparison)) {
				logger.info(formatRequestLogLine(requestKind, `[cache-trace #${requestId}] ${detailLine}`));
			}
			for (const warning of getCacheTraceComparisonWarnings(cacheTraceComparison)) {
				logger.warn(formatRequestLogLine(requestKind, `[cache-trace #${requestId}] ${warning}`));
			}
		}
		if (traceKeyChangeComparison && previousImmediateCacheTrace) {
			logger.info(
				formatRequestLogLine(
					requestKind,
					`[cache-trace #${requestId}] ${formatCacheTraceKeyChangeComparison(
						previousImmediateCacheTrace.cacheTraceKey,
						cacheTrace.cacheTraceKey,
						traceKeyChangeComparison,
					)}`,
				),
			);
			for (const detailLine of formatCacheTraceComparisonDetailLines(traceKeyChangeComparison)) {
				logger.info(
					formatRequestLogLine(
						requestKind,
						`[cache-trace #${requestId}] cacheTraceKeyChanged ${detailLine}`,
					),
				);
			}
			for (const warning of getCacheTraceComparisonWarnings(traceKeyChangeComparison)) {
				logger.warn(
					formatRequestLogLine(
						requestKind,
						`[cache-trace #${requestId}] cacheTraceKeyChanged fallback diff: ${warning}`,
					),
				);
			}
		}
		if (skippedImmediateFallback) {
			logger.info(
				formatRequestLogLine(
					requestKind,
					`[cache-trace #${requestId}] comparisonScopeChanged` +
						` prevKind=${skippedImmediateFallback.requestKind}` +
						` currKind=${cacheTrace.requestKind}` +
						` prevModel=${skippedImmediateFallback.model}` +
						` currModel=${cacheTrace.model}` +
						` toolsChanged=${skippedImmediateFallback.toolsHash !== cacheTrace.toolsHash}` +
						` cacheTraceKeyChanged=true skipFallbackDiff=true`,
				),
			);
		}
		if (scopedTraceKeyChangeComparison && previousScopedCacheTrace) {
			logger.info(
				formatRequestLogLine(
					requestKind,
					`[cache-trace #${requestId}] sameScope ${formatCacheTraceKeyChangeComparison(
						previousScopedCacheTrace.cacheTraceKey,
						cacheTrace.cacheTraceKey,
						scopedTraceKeyChangeComparison,
					)}`,
				),
			);
			for (const detailLine of formatCacheTraceComparisonDetailLines(
				scopedTraceKeyChangeComparison,
			)) {
				logger.info(
					formatRequestLogLine(
						requestKind,
						`[cache-trace #${requestId}] sameScope cacheTraceKeyChanged ${detailLine}`,
					),
				);
			}
			for (const warning of getCacheTraceComparisonWarnings(scopedTraceKeyChangeComparison)) {
				logger.warn(
					formatRequestLogLine(
						requestKind,
						`[cache-trace #${requestId}] sameScope cacheTraceKeyChanged fallback diff: ${warning}`,
					),
				);
			}
		}
		for (const warning of getCacheTraceWarnings(cacheTrace)) {
			logger.warn(formatRequestLogLine(requestKind, `[cache-trace #${requestId}] ${warning}`));
		}
		for (const infoLine of getCacheTraceInfoLines(cacheTrace)) {
			logger.info(formatRequestLogLine(requestKind, `[cache-trace #${requestId}] ${infoLine}`));
		}

		return new ActiveCacheDiagnosticsRun(
			this,
			requestId,
			cacheTrace,
			{
				vscodeModelId: options.vscodeModelId,
				apiModelId: options.request.model,
				requestKind,
			},
			cacheTraceComparison ?? traceKeyChangeComparison ?? scopedTraceKeyChangeComparison,
			cacheTraceComparison
				? 'summaryPrefixVsPrevious'
				: scopedTraceKeyChangeComparison
					? 'sameScopeFallbackSummaryPrefixVsPrevious'
					: 'fallbackSummaryPrefixVsPrevious',
		);
	}

	private clearCacheTraces(): void {
		this.lastCacheTrace = undefined;
		this.previousCacheTraces.clear();
		this.lastCacheTracesByScope.clear();
	}

	rememberCacheTrace(snapshot: CacheTraceSnapshot): void {
		this.lastCacheTrace = snapshot;
		this.lastCacheTracesByScope.set(getCacheTraceScopeKey(snapshot), snapshot);
		while (this.lastCacheTracesByScope.size > 50) {
			const oldestKey = this.lastCacheTracesByScope.keys().next().value;
			if (!oldestKey) {
				break;
			}
			this.lastCacheTracesByScope.delete(oldestKey);
		}

		const cacheTraceStoreKey = getCacheTraceStoreKey(snapshot);
		this.previousCacheTraces.delete(cacheTraceStoreKey);
		this.previousCacheTraces.set(cacheTraceStoreKey, snapshot);

		while (this.previousCacheTraces.size > 50) {
			const oldestKey = this.previousCacheTraces.keys().next().value;
			if (!oldestKey) {
				break;
			}
			this.previousCacheTraces.delete(oldestKey);
		}
	}
}

function getCacheTraceStoreKey(snapshot: CacheTraceSnapshot): string {
	return `${snapshot.requestKind}:${snapshot.cacheTraceKey}`;
}

function getCacheTraceScopeKey(snapshot: CacheTraceSnapshot): string {
	return `${snapshot.requestKind}:${snapshot.model}:${snapshot.toolsHash}`;
}

class ActiveCacheDiagnosticsRun implements CacheDiagnosticsRun {
	private cancellationLogged = false;

	constructor(
		private readonly recorder: DefaultCacheDiagnosticsRecorder,
		private readonly requestId: number,
		private readonly snapshot: CacheTraceSnapshot,
		private readonly usageLogContext: UsageLogContext,
		private readonly resultComparison: CacheTraceComparison | undefined,
		private readonly prefixLabel: string,
	) {}

	onDone(info: CacheDiagnosticsDoneInfo): void {
		if (info.emittedToolCalls > 0 || info.trailingToolResults > 0) {
			logger.info(
				formatRequestLogLine(
					this.snapshot.requestKind,
					`[cache-trace #${this.requestId}] stream done reasoningTextChars=${info.reasoningTextChars}` +
						` emittedToolCalls=${info.emittedToolCalls}` +
						` trailingToolResults=${info.trailingToolResults}`,
				),
			);
		}
		this.recorder.rememberCacheTrace(this.snapshot);
	}

	onUsage(usage: DeepSeekUsage, charsPerToken: number): void {
		logUsage(usage, charsPerToken, this.usageLogContext, this.requestId);
		if (this.resultComparison) {
			const hitRate = getCacheHitRate(usage);
			logger.info(
				formatRequestLogLine(
					this.snapshot.requestKind,
					`[cache-trace #${this.requestId}] result cacheRate=${hitRate}%` +
						` ${this.prefixLabel}=${this.resultComparison.commonPrefixSummaryChars}` +
						` chars (${this.resultComparison.commonPrefixSummaryPercent.toFixed(1)}%)`,
				),
			);
		}
	}

	onCancellationTokenRequested(): void {
		if (this.cancellationLogged) {
			return;
		}
		this.cancellationLogged = true;
		logger.info(
			formatRequestLogLine(
				this.snapshot.requestKind,
				`[cache-trace #${this.requestId}] cancellation token requested; aborting stream`,
			),
		);
	}

	onReplayMarkerReport(info: ReplayMarkerReportInfo): void {
		logger.info(
			formatRequestLogLine(
				this.snapshot.requestKind,
				`[cache-trace #${this.requestId}] ${formatReplayMarkerReport(info)}`,
			),
		);
	}
}

class NoopCacheDiagnosticsRun implements CacheDiagnosticsRun {
	constructor(private readonly usageLogContext: UsageLogContext) {}

	onDone(_info: CacheDiagnosticsDoneInfo): void {}

	onCancellationTokenRequested(): void {}

	onReplayMarkerReport(_info: ReplayMarkerReportInfo): void {}

	onUsage(usage: DeepSeekUsage, charsPerToken: number): void {
		logUsage(usage, charsPerToken, this.usageLogContext);
	}
}

function formatSegmentTrace(segment: ConversationSegment): string {
	let legacyMarker = '';
	if (segment.reason === 'markerFound') {
		legacyMarker = ' legacySegmentMarker=found';
	} else if (segment.reason === 'markerInvalid') {
		const markerLocation =
			segment.markerMessageIndex === undefined || segment.markerPartIndex === undefined
				? ''
				: ` at=message#${segment.markerMessageIndex}:part#${segment.markerPartIndex}`;
		const markerError = segment.markerError ? ` error=${segment.markerError}` : '';
		legacyMarker = ` legacySegmentMarker=invalid${markerLocation}${markerError}`;
	}
	return ` dumpSegment=${segment.segmentId}${legacyMarker}`;
}

function formatReplayMarkerReport(info: ReplayMarkerReportInfo): string {
	const trigger = info.trigger ? ` trigger=${info.trigger}` : '';
	const markerBytes = info.markerBytes === undefined ? '' : ` markerBytes=${info.markerBytes}`;
	const visionTextChars =
		info.visionTextChars === undefined ? '' : ` visionTextChars=${info.visionTextChars}`;
	const reasoningTextChars =
		info.reasoningTextChars === undefined ? '' : ` reasoningTextChars=${info.reasoningTextChars}`;
	const reason = info.reason ? ` reason=${info.reason}` : '';
	const error = info.error ? ` error=${formatError(info.error)}` : '';
	return (
		`replayMarker status=${info.status}` +
		trigger +
		markerBytes +
		visionTextChars +
		reasoningTextChars +
		reason +
		error
	);
}

function summarizeHostPromptTrace(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): HostPromptTrace {
	let customizationsUpdateCount = 0;
	let latestUserMessageIndex: number | null = null;
	let latestUserHasCustomizationsUpdate = false;

	for (const [index, message] of messages.entries()) {
		const text = getMessageText(message);
		customizationsUpdateCount += countLiteral(text, '<customizationsUpdate>');
		if (message.role === vscode.LanguageModelChatMessageRole.User) {
			latestUserMessageIndex = index;
			latestUserHasCustomizationsUpdate = text.includes('<customizationsUpdate>');
		}
	}

	const systemMessage = messages[0];
	const systemText = systemMessage ? getMessageText(systemMessage) : '';

	return {
		hostFreezeCustomizationsIndex: getHostFreezeCustomizationsIndex(),
		systemMessageIndex: systemMessage ? 0 : null,
		systemRole: systemMessage ? formatVscodeMessageRole(systemMessage.role) : null,
		systemChars: systemText.length,
		systemLines: countLines(systemText),
		systemHash: systemMessage ? hashString(systemText) : null,
		hasSkillsTag: systemText.includes('<skills>'),
		hasAgentsTag: systemText.includes('<agents>'),
		skillTagCount: countLiteral(systemText, '<skill>'),
		agentTagCount: countLiteral(systemText, '<agent>'),
		customizationsUpdateCount,
		latestUserMessageIndex,
		latestUserHasCustomizationsUpdate,
	};
}

function getHostFreezeCustomizationsIndex(): boolean | 'unknown' {
	const value = vscode.workspace
		.getConfiguration('github.copilot.chat')
		.get<unknown>('freezeCustomizationsIndex');
	return typeof value === 'boolean' ? value : 'unknown';
}

function formatHostPromptTrace(trace: HostPromptTrace): string {
	const systemPrompt =
		trace.systemMessageIndex === null
			? 'systemPrompt=none'
			: `systemPrompt#${trace.systemMessageIndex}:${trace.systemRole}` +
				`:chars=${trace.systemChars}` +
				`:lines=${trace.systemLines}` +
				`:hash=${trace.systemHash ?? 'none'}` +
				`:skills=${formatYesNo(trace.hasSkillsTag)}(${trace.skillTagCount})` +
				`:agents=${formatYesNo(trace.hasAgentsTag)}(${trace.agentTagCount})`;

	return (
		`hostFreezeCustomizationsIndex=${trace.hostFreezeCustomizationsIndex}` +
		` ${systemPrompt}` +
		` customizationsUpdate=${trace.customizationsUpdateCount}` +
		` latestUser#${trace.latestUserMessageIndex ?? 'none'}=` +
		formatYesNo(trace.latestUserHasCustomizationsUpdate)
	);
}

function shouldLogHostPromptTrace(trace: HostPromptTrace): boolean {
	return trace.customizationsUpdateCount > 0 || trace.latestUserHasCustomizationsUpdate;
}

function formatYesNo(value: boolean): 'yes' | 'no' {
	return value ? 'yes' : 'no';
}

function appendNumberIfNonZero(parts: string[], name: string, value: number): void {
	if (value > 0) {
		parts.push(`${name}=${value}`);
	}
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return sanitizeLogValue(error.message || error.name);
	}
	if (typeof error === 'string') {
		return sanitizeLogValue(error);
	}
	return sanitizeLogValue(String(error));
}

function sanitizeLogValue(value: string): string {
	return value.replace(/\s+/g, ' ').slice(0, 200);
}

function logUsage(
	usage: DeepSeekUsage,
	charsPerToken: number,
	context: UsageLogContext,
	requestId?: number,
): void {
	const cacheHit = usage.prompt_cache_hit_tokens ?? 0;
	const cacheMiss = usage.prompt_cache_miss_tokens ?? 0;
	logger.info(
		formatRequestLogLine(
			context.requestKind,
			`tokens${requestId ? ` #${requestId}` : ''}: ` +
				formatModelFields(context.vscodeModelId, context.apiModelId) +
				` prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}` +
				` | cache: hit=${cacheHit} miss=${cacheMiss} rate=${getCacheHitRate(usage)}%` +
				` | chars/tok=${charsPerToken.toFixed(2)}`,
		),
	);
}

function getCacheHitRate(usage: DeepSeekUsage): string {
	const cacheHit = usage.prompt_cache_hit_tokens ?? 0;
	const cacheMiss = usage.prompt_cache_miss_tokens ?? 0;
	const cacheTotal = cacheHit + cacheMiss;
	return cacheTotal > 0 ? ((cacheHit / cacheTotal) * 100).toFixed(0) : 'n/a';
}

function summarizeVisionResolution(
	inputMessages: readonly vscode.LanguageModelChatRequestMessage[],
	resolvedMessages: readonly vscode.LanguageModelChatRequestMessage[],
	visionModelId: string | undefined,
	visionProxySource: VisionProxySource | undefined,
): VisionMessageStats {
	const stats: VisionMessageStats = {
		inputImageParts: 0,
		inputImageMessages: 0,
		describedImageMessages: 0,
		failedImageMessages: 0,
		droppedImageParts: 0,
		historyDescriptionMessages: 0,
		visionModelId,
		visionProxySource,
	};

	for (const [index, message] of inputMessages.entries()) {
		const imageParts = countImageDataParts(message);
		const inputText = getMessageText(message);
		if (countLiteral(inputText, '[Image Description:') > 0) {
			stats.historyDescriptionMessages += 1;
		}

		if (imageParts > 0) {
			stats.inputImageMessages += 1;
			stats.inputImageParts += imageParts;

			const resolvedMessage = resolvedMessages[index];
			const resolvedImageParts = resolvedMessage ? countImageDataParts(resolvedMessage) : 0;
			const resolvedText = resolvedMessage ? getMessageText(resolvedMessage) : '';
			const newDescriptions = Math.max(
				0,
				countLiteral(resolvedText, '[Image Description:') -
					countLiteral(inputText, '[Image Description:'),
			);
			const newFailures = Math.max(
				0,
				countLiteral(resolvedText, IMAGE_DESCRIPTION_UNAVAILABLE) -
					countLiteral(inputText, IMAGE_DESCRIPTION_UNAVAILABLE),
			);

			if (newDescriptions > 0) {
				stats.describedImageMessages += 1;
			}
			if (newFailures > 0) {
				stats.failedImageMessages += 1;
			}
			if (resolvedImageParts < imageParts && newDescriptions === 0 && newFailures === 0) {
				stats.droppedImageParts += imageParts - resolvedImageParts;
			}
		}
	}

	return stats;
}

function countImageDataParts(message: vscode.LanguageModelChatRequestMessage): number {
	return message.content.filter((part) => isImageDataPart(part)).length;
}

function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
	return part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/');
}

function getMessageText(message: vscode.LanguageModelChatRequestMessage): string {
	let text = '';
	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			text += part.value;
		}
	}
	return text;
}

function formatVisionTrace(
	stats: VisionMessageStats,
	pipelineStats: VisionPipelineStats | undefined,
): string | undefined {
	if (
		stats.inputImageParts === 0 &&
		stats.historyDescriptionMessages === 0 &&
		!hasVisionPipelineActivity(pipelineStats)
	) {
		return undefined;
	}

	const note =
		stats.inputImageParts === 0 && stats.historyDescriptionMessages > 0 ? ' note=history-only' : '';
	const visionModel = formatVisionModel(stats);
	const parts = [
		`vision inputImages=${stats.inputImageParts}`,
		`inputMessages=${stats.inputImageMessages}`,
	];

	if (pipelineStats && hasVisionPipelineActivity(pipelineStats)) {
		parts.push(
			`current=${pipelineStats.currentImageMessages}`,
			`generated=${pipelineStats.generatedImageMessages}`,
			`replayed=${pipelineStats.replayedImageMessages}`,
			`omitted=${pipelineStats.omittedImageMessages}`,
			`droppedParts=${pipelineStats.droppedImageParts}`,
		);
		appendNumberIfNonZero(parts, 'unavailable', pipelineStats.unavailableImageMessages);
		appendNumberIfNonZero(parts, 'failed', pipelineStats.failedImageMessages);
		appendNumberIfNonZero(parts, 'markerChars', pipelineStats.markerVisionTextChars);
		appendNumberIfNonZero(parts, 'invalidMarkerVision', pipelineStats.invalidMarkerVisionMetadata);
	} else {
		appendNumberIfNonZero(parts, 'generated', stats.describedImageMessages);
		appendNumberIfNonZero(parts, 'failed', stats.failedImageMessages);
		appendNumberIfNonZero(parts, 'droppedParts', stats.droppedImageParts);
	}

	parts.push(`model=${visionModel}`);
	if (stats.visionProxySource) {
		parts.push(`source=${stats.visionProxySource}`);
	}
	appendNumberIfNonZero(parts, 'historyDescriptions', stats.historyDescriptionMessages);
	return parts.join(' ') + note;
}

function hasVisionPipelineActivity(stats: VisionPipelineStats | undefined): boolean {
	if (!stats) {
		return false;
	}
	return (
		stats.inputImageParts > 0 ||
		stats.currentImageMessages > 0 ||
		stats.generatedImageMessages > 0 ||
		stats.replayedImageMessages > 0 ||
		stats.omittedImageMessages > 0 ||
		stats.unavailableImageMessages > 0 ||
		stats.failedImageMessages > 0 ||
		stats.invalidMarkerVisionMetadata > 0
	);
}

function formatVisionModel(stats: VisionMessageStats): string {
	if (stats.visionModelId) {
		return stats.visionModelId;
	}
	if (stats.inputImageParts === 0) {
		return 'none';
	}
	if (
		stats.droppedImageParts > 0 &&
		stats.describedImageMessages === 0 &&
		stats.failedImageMessages === 0
	) {
		return 'none';
	}
	return 'unknown';
}

function formatVscodeMessageTrace(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): string | undefined {
	if (messages.length === 0) {
		return undefined;
	}

	let hasInterestingParts = false;
	const traces = messages.map((msg, index) => {
		const role = formatVscodeMessageRole(msg.role);
		let textChars = 0;
		let imageParts = 0;
		let toolCallParts = 0;
		let toolResultParts = 0;
		let thinkingParts = 0;
		let thinkingChars = 0;
		let replayMarkerParts = 0;
		let hostCacheControlParts = 0;
		const dataPartMimes = new Map<string, number>();
		const thinkingValueTypes = new Set<string>();
		const thinkingHashes: string[] = [];
		const unknownPartConstructors = new Map<string, number>();

		for (const part of msg.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				textChars += part.value.length;
			} else if (part instanceof vscode.LanguageModelDataPart) {
				if (part.mimeType.startsWith('image/')) {
					imageParts += 1;
				} else if (part.mimeType === REPLAY_MARKER_MIME) {
					replayMarkerParts += 1;
				} else if (part.mimeType === HOST_CACHE_CONTROL_MIME) {
					hostCacheControlParts += 1;
				} else {
					dataPartMimes.set(part.mimeType, (dataPartMimes.get(part.mimeType) ?? 0) + 1);
				}
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCallParts += 1;
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				toolResultParts += 1;
			} else if (isLanguageModelThinkingPart(part)) {
				const value = normalizeThinkingPartValue(part.value);
				thinkingParts += 1;
				thinkingChars += value.text.length;
				thinkingValueTypes.add(value.type);
				thinkingHashes.push(hashString(value.text));
			} else {
				const constructorName = getPartConstructorName(part);
				unknownPartConstructors.set(
					constructorName,
					(unknownPartConstructors.get(constructorName) ?? 0) + 1,
				);
			}
		}

		const parts: string[] = [];
		if (imageParts) {
			parts.push(`image=${imageParts}`);
		}
		if (toolCallParts) {
			parts.push(`toolCalls=${toolCallParts}`);
		}
		if (toolResultParts) {
			parts.push(`toolResults=${toolResultParts}`);
		}
		if (thinkingParts) {
			parts.push(
				`thinking=${thinkingParts}:chars=${thinkingChars}:types=${[...thinkingValueTypes].join(
					'+',
				)}:hashes=${thinkingHashes.join(',')}`,
			);
		}
		if (replayMarkerParts) {
			parts.push(`replayMarker=${replayMarkerParts}`);
		}
		for (const [mimeType, count] of dataPartMimes) {
			parts.push(`data=${mimeType}:${count}`);
		}
		if (hostCacheControlParts > 1) {
			parts.push(`cacheControl=${hostCacheControlParts}`);
		}
		for (const [constructorName, count] of unknownPartConstructors) {
			parts.push(`unknown=${constructorName}:${count}`);
		}

		const suffix = parts.length > 0 ? ` (${parts.join(',')})` : '';
		if (parts.length > 0) {
			hasInterestingParts = true;
		}

		return `${role}#${index}:chars=${textChars}${suffix}`;
	});

	return hasInterestingParts ? traces.join(' | ') : undefined;
}

function formatVscodeMessageRole(role: vscode.LanguageModelChatMessageRole): string {
	if (role === vscode.LanguageModelChatMessageRole.User) return 'user';
	if (role === vscode.LanguageModelChatMessageRole.Assistant) return 'assistant';
	if (role === LANGUAGE_MODEL_CHAT_SYSTEM_ROLE) return 'system';
	return 'unknown';
}

function summarizeInputAssistantMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): CacheTraceInputAssistantSummary[] {
	const summaries: CacheTraceInputAssistantSummary[] = [];

	for (const [index, message] of messages.entries()) {
		if (message.role !== vscode.LanguageModelChatMessageRole.Assistant) {
			continue;
		}

		let textChars = 0;
		let toolCalls = 0;
		let thinkingChars = 0;
		let replayMarkerParts = 0;

		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				textChars += part.value.length;
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls += 1;
			} else if (isLanguageModelThinkingPart(part)) {
				thinkingChars += normalizeThinkingPartValue(part.value).text.length;
			} else if (
				part instanceof vscode.LanguageModelDataPart &&
				part.mimeType === REPLAY_MARKER_MIME
			) {
				replayMarkerParts += 1;
			}
		}

		if (!textChars && !toolCalls) {
			continue;
		}

		const replayMarker = parseFirstReplayMarker(message);
		summaries.push({
			index,
			textChars,
			toolCalls,
			thinkingChars,
			replayMarkerParts,
			replayMarkerReasoningChars: replayMarker?.reasoningText?.length ?? 0,
			replayMarkerInvalid: replayMarker?.valid === false,
		});
	}

	return summaries;
}

function isLanguageModelThinkingPart(part: unknown): part is vscode.LanguageModelThinkingPart {
	return (
		typeof vscode.LanguageModelThinkingPart === 'function' &&
		part instanceof vscode.LanguageModelThinkingPart
	);
}

function normalizeThinkingPartValue(value: string | string[]): { text: string; type: string } {
	if (Array.isArray(value)) {
		return { text: value.join(''), type: 'string[]' };
	}
	return { text: value, type: 'string' };
}

function getPartConstructorName(part: unknown): string {
	if (!part || typeof part !== 'object') {
		return typeof part;
	}
	return part.constructor?.name ?? 'object';
}

export function createCacheTraceSnapshot(
	request: DeepSeekRequest,
	inputMessages: readonly vscode.LanguageModelChatRequestMessage[] = [],
	requestKind: RequestKind = classifyDeepSeekRequest({ request, inputMessages }),
): CacheTraceSnapshot {
	const toolsSerialized = stableStringify(request.tools ?? []);
	const messageSummaries = summarizeMessages(request.messages);
	const toolSummaries = summarizeTools(request.tools ?? []);
	const firstMessage = messageSummaries[0];
	const redactedComparisonInput = createRedactedComparisonInput(
		request,
		messageSummaries,
		toolSummaries,
	);

	return {
		fingerprint: hashString(redactedComparisonInput),
		requestKind,
		model: request.model,
		cacheTraceKey: hashString(`${request.model}:${firstMessage?.hash ?? 'empty'}`),
		redactedComparisonInput,
		requiresReasoningContent: request.thinking?.type === 'enabled',
		inputAssistantSummaries: summarizeInputAssistantMessages(inputMessages),
		toolsHash: hashString(toolsSerialized),
		toolSummaries,
		messageSummaries,
		stats: summarizeStats(request.messages, request.tools?.length ?? 0),
	};
}

function createRedactedComparisonInput(
	request: DeepSeekRequest,
	messageSummaries: CacheTraceMessageSummary[],
	toolSummaries: CacheTraceToolSummary[],
): string {
	return stableStringify({
		model: request.model,
		tool_choice: request.tool_choice ?? null,
		thinking: request.thinking ?? null,
		reasoning_effort: request.reasoning_effort ?? null,
		tools: toolSummaries,
		messages: messageSummaries,
	});
}

export function compareCacheTraceSnapshots(
	previous: CacheTraceSnapshot | undefined,
	current: CacheTraceSnapshot,
): CacheTraceComparison | undefined {
	if (!previous) {
		return undefined;
	}

	const commonPrefixSummaryChars = countCommonPrefixChars(
		previous.redactedComparisonInput,
		current.redactedComparisonInput,
	);
	const firstChangedMessageIndex = findFirstChangedMessageIndex(
		previous.messageSummaries,
		current.messageSummaries,
	);
	const firstChangedToolIndex = findFirstChangedToolIndex(
		previous.toolSummaries,
		current.toolSummaries,
	);
	const previousMessage =
		firstChangedMessageIndex === undefined
			? undefined
			: previous.messageSummaries[firstChangedMessageIndex];
	const currentMessage =
		firstChangedMessageIndex === undefined
			? undefined
			: current.messageSummaries[firstChangedMessageIndex];

	return {
		commonPrefixSummaryChars,
		commonPrefixSummaryPercent:
			current.redactedComparisonInput.length > 0
				? (commonPrefixSummaryChars / current.redactedComparisonInput.length) * 100
				: 100,
		previousMessageCount: previous.messageSummaries.length,
		currentMessageCount: current.messageSummaries.length,
		firstChangedMessageIndex,
		previousMessage,
		currentMessage,
		toolsChanged: previous.toolsHash !== current.toolsHash,
		previousToolsHash: previous.toolsHash,
		currentToolsHash: current.toolsHash,
		firstChangedToolIndex,
		previousTool:
			firstChangedToolIndex === undefined
				? undefined
				: previous.toolSummaries[firstChangedToolIndex],
		currentTool:
			firstChangedToolIndex === undefined
				? undefined
				: current.toolSummaries[firstChangedToolIndex],
		systemPromptChange:
			firstChangedMessageIndex === 0
				? compareSystemPromptSections(previousMessage, currentMessage)
				: undefined,
	};
}

export function formatCacheTraceSnapshot(snapshot: CacheTraceSnapshot): string {
	const stats = snapshot.stats;
	const parts = [
		`fingerprint=${snapshot.fingerprint}`,
		`cacheTraceKey=${snapshot.cacheTraceKey}`,
		`messages=${stats.messageCount}`,
		`roles(user=${stats.userMessages},assistant=${stats.assistantMessages},tool=${stats.toolMessages},system=${stats.systemMessages})`,
		`tools=${stats.toolCount}`,
		`chars(content=${stats.totalContentChars},toolArgs=${stats.toolCallArgumentChars},reasoning=${stats.reasoningChars})`,
	];

	if (
		stats.assistantToolCallMessages > 0 ||
		stats.nonEmptyToolReasoningMessages > 0 ||
		stats.emptyToolReasoningMessages > 0 ||
		stats.missingToolReasoningMessages > 0
	) {
		parts.push(
			`toolReasoning(messages=${stats.assistantToolCallMessages},nonEmpty=${stats.nonEmptyToolReasoningMessages},empty=${stats.emptyToolReasoningMessages},missing=${stats.missingToolReasoningMessages})`,
		);
	}

	if (
		stats.assistantAfterToolResultMessages > 0 ||
		stats.nonEmptyPostToolReasoningMessages > 0 ||
		stats.emptyPostToolReasoningMessages > 0 ||
		stats.missingPostToolReasoningMessages > 0
	) {
		parts.push(
			`postToolReasoning(messages=${stats.assistantAfterToolResultMessages},toolCall=${stats.assistantAfterToolResultToolCallMessages},final=${stats.assistantAfterToolResultFinalMessages},nonEmpty=${stats.nonEmptyPostToolReasoningMessages},empty=${stats.emptyPostToolReasoningMessages},missing=${stats.missingPostToolReasoningMessages})`,
		);
	}

	appendNumberIfNonZero(parts, 'imageDescriptions', stats.imageDescriptionMessages);
	appendNumberIfNonZero(parts, 'largeMessages', stats.largeMessages);
	return parts.join(' ');
}

export function formatCacheTraceDetailLines(snapshot: CacheTraceSnapshot): string[] {
	const stats = snapshot.stats;
	const lines: string[] = [];
	if (stats.imageDescriptionParts > 0 || stats.unableImageMessages > 0) {
		lines.push(
			`imageText imageDescMsgs=${stats.imageDescriptionMessages}` +
				` imageDescParts=${stats.imageDescriptionParts}` +
				` unableImageMsgs=${stats.unableImageMessages}`,
		);
	}
	if (stats.urlMessages > 0 || stats.codeFenceMessages > 0) {
		lines.push(
			`contentMarkers urlMsgs=${stats.urlMessages}` +
				` urlCount=${stats.urlCount}` +
				` codeFenceMsgs=${stats.codeFenceMessages}` +
				` codeFenceCount=${stats.codeFenceCount}`,
		);
	}
	return lines;
}

export function formatCacheTraceComparison(comparison: CacheTraceComparison): string {
	const changedMessage =
		comparison.firstChangedMessageIndex === undefined
			? 'none'
			: `${comparison.firstChangedMessageIndex} prev=${formatMessageSummary(
					comparison.previousMessage,
				)} curr=${formatMessageSummary(comparison.currentMessage)}`;
	const changedTool = comparison.toolsChanged
		? ` toolsHash=${comparison.previousToolsHash}->${comparison.currentToolsHash}` +
			` firstChangedTool=${formatChangedTool(comparison)}`
		: '';

	return (
		`summaryPrefixVsPrevious chars=${comparison.commonPrefixSummaryChars}` +
		` percent=${comparison.commonPrefixSummaryPercent.toFixed(1)}%` +
		` toolsChanged=${comparison.toolsChanged}` +
		changedTool +
		` firstChangedMessage=${changedMessage}`
	);
}

export function formatCacheTraceKeyChangeComparison(
	previousCacheTraceKey: string,
	currentCacheTraceKey: string,
	comparison: CacheTraceComparison,
): string {
	const changedMessage =
		comparison.firstChangedMessageIndex === undefined
			? 'none'
			: `${comparison.firstChangedMessageIndex} prev=${formatMessageSummary(
					comparison.previousMessage,
				)} curr=${formatMessageSummary(comparison.currentMessage)}`;
	const changedTool = comparison.toolsChanged
		? ` toolsHash=${comparison.previousToolsHash}->${comparison.currentToolsHash}` +
			` firstChangedTool=${formatChangedTool(comparison)}`
		: '';

	return (
		`cacheTraceKeyChanged=true prev=${previousCacheTraceKey} curr=${currentCacheTraceKey}` +
		` fallbackSummaryPrefixVsPrevious chars=${comparison.commonPrefixSummaryChars}` +
		` percent=${comparison.commonPrefixSummaryPercent.toFixed(1)}%` +
		` toolsChanged=${comparison.toolsChanged}` +
		changedTool +
		` firstChangedMessage=${changedMessage}`
	);
}

export function formatCacheTraceComparisonDetailLines(comparison: CacheTraceComparison): string[] {
	if (
		comparison.firstChangedMessageIndex === undefined ||
		!comparison.previousMessage ||
		!comparison.currentMessage
	) {
		return [];
	}

	const previous = comparison.previousMessage;
	const current = comparison.currentMessage;
	return [
		`changedMessage position=index${comparison.firstChangedMessageIndex}` +
			` fromEndPrev=${comparison.previousMessageCount - comparison.firstChangedMessageIndex - 1}` +
			` fromEndCurr=${comparison.currentMessageCount - comparison.firstChangedMessageIndex - 1}` +
			` delta(chars=${current.contentChars - previous.contentChars}` +
			`,lines=${current.contentLines - previous.contentLines}` +
			`,toolArgs=${current.toolCallArgumentChars - previous.toolCallArgumentChars}` +
			`,reasoning=${current.reasoningChars - previous.reasoningChars})`,
	];
}

export function getCacheTraceWarnings(snapshot: CacheTraceSnapshot): string[] {
	const warnings: string[] = [];
	if (!snapshot.requiresReasoningContent) {
		return warnings;
	}
	if (snapshot.stats.missingToolReasoningMessages > 0) {
		warnings.push(
			`${snapshot.stats.missingToolReasoningMessages} assistant tool-call message(s) are missing marker-replayed reasoning_content; DeepSeek requires this in thinking tool-call histories and cache prefixes may drift.`,
		);
	}
	if (snapshot.stats.missingPostToolCallReasoningMessages > 0) {
		warnings.push(
			`${snapshot.stats.missingPostToolCallReasoningMessages} assistant tool-call message(s) after tool results are missing marker-replayed reasoning_content.`,
		);
	}
	if (snapshot.stats.missingPostToolFinalReasoningMessages > 0) {
		warnings.push(
			`${snapshot.stats.missingPostToolFinalReasoningMessages} final assistant message(s) after tool results are missing marker-replayed reasoning_content.`,
		);
	}
	const recoveryLostEmptyMessages = countEmptyReasoningFallbackMessages(snapshot, 'recovery-lost');
	if (recoveryLostEmptyMessages > 0) {
		warnings.push(
			`${recoveryLostEmptyMessages} reasoning-required assistant message reference(s) have empty reasoning_content fallback despite a non-empty VS Code thinking/replay marker source; marker replay may have failed.`,
		);
	}
	const unknownEmptyMessages = countEmptyReasoningFallbackMessages(snapshot, 'unknown');
	if (unknownEmptyMessages > 0) {
		warnings.push(
			`${unknownEmptyMessages} reasoning-required assistant message reference(s) have empty reasoning_content fallback; unable to classify whether the original VS Code message had recoverable reasoning data.`,
		);
	}
	return warnings;
}

export function getCacheTraceInfoLines(snapshot: CacheTraceSnapshot): string[] {
	const infoLines: string[] = [];
	if (!snapshot.requiresReasoningContent) {
		return infoLines;
	}
	const upstreamEmptyMessages = countEmptyReasoningFallbackMessages(
		snapshot,
		'upstream-no-reasoning',
	);
	if (upstreamEmptyMessages > 0) {
		infoLines.push(
			`${upstreamEmptyMessages} reasoning-required assistant message reference(s) have empty reasoning_content fallback because the original VS Code assistant message had no non-empty thinking/replay marker source; likely upstream returned no usable reasoning_content.`,
		);
	}
	return infoLines;
}

type EmptyReasoningFallbackCause = 'upstream-no-reasoning' | 'recovery-lost' | 'unknown';

function countEmptyReasoningFallbackMessages(
	snapshot: CacheTraceSnapshot,
	cause: EmptyReasoningFallbackCause,
): number {
	let count = 0;
	let assistantOrdinal = 0;
	for (const message of snapshot.messageSummaries) {
		if (message.role !== 'assistant') {
			continue;
		}
		if (
			isReasoningRequiredEmptyFallback(message) &&
			classifyEmptyReasoningFallback(snapshot, assistantOrdinal) === cause
		) {
			count += 1;
		}
		assistantOrdinal += 1;
	}
	return count;
}

function isReasoningRequiredEmptyFallback(message: CacheTraceMessageSummary): boolean {
	return (
		message.emptyReasoning && (message.toolCalls > 0 || message.afterToolResultKind === 'final')
	);
}

function classifyEmptyReasoningFallback(
	snapshot: CacheTraceSnapshot,
	assistantOrdinal: number,
): EmptyReasoningFallbackCause {
	const inputAssistant = snapshot.inputAssistantSummaries[assistantOrdinal];
	if (!inputAssistant) {
		return 'unknown';
	}
	if (
		inputAssistant.thinkingChars > 0 ||
		inputAssistant.replayMarkerReasoningChars > 0 ||
		inputAssistant.replayMarkerInvalid
	) {
		return 'recovery-lost';
	}
	return 'upstream-no-reasoning';
}

export function getCacheTraceComparisonWarnings(comparison: CacheTraceComparison): string[] {
	const warnings: string[] = [];
	if (
		comparison.firstChangedMessageIndex !== undefined &&
		comparison.previousMessage &&
		comparison.currentMessage
	) {
		const previousMessagesAfterChange =
			comparison.previousMessageCount - comparison.firstChangedMessageIndex - 1;
		if (comparison.systemPromptChange) {
			warnings.push(
				`system prompt changed; ${formatSystemPromptChange(comparison.systemPromptChange)}.`,
			);
		}
		if (previousMessagesAfterChange > 2) {
			warnings.push(
				`retained history changed before the append boundary at message #${comparison.firstChangedMessageIndex}; ${previousMessagesAfterChange} previous message(s) after it cannot share an identical request prefix.`,
			);
		}
	}
	if (comparison.toolsChanged) {
		warnings.push(
			`tool schema changed; firstChangedTool=${formatChangedTool(comparison)}. A changed tool list rebuilds the cache prefix before messages.`,
		);
	}
	if (comparison.currentMessageCount < comparison.previousMessageCount) {
		warnings.push(
			`message count decreased ${comparison.previousMessageCount}->${comparison.currentMessageCount}; host-side history truncation or compaction may have occurred.`,
		);
	}
	return warnings;
}

function compareSystemPromptSections(
	previous: CacheTraceMessageSummary | undefined,
	current: CacheTraceMessageSummary | undefined,
): CacheTraceSystemPromptChange | undefined {
	if (!previous || !current) {
		return {
			firstChangedSectionIndex: undefined,
			previousSection: previous?.contentSections?.[0],
			currentSection: current?.contentSections?.[0],
		};
	}
	if (previous.contentHash === current.contentHash) {
		return undefined;
	}

	const previousSections = previous.contentSections ?? [];
	const currentSections = current.contentSections ?? [];
	const maxLength = Math.max(previousSections.length, currentSections.length);
	for (let index = 0; index < maxLength; index += 1) {
		const previousSection = previousSections[index];
		const currentSection = currentSections[index];
		if (
			previousSection?.hash !== currentSection?.hash ||
			previousSection?.label !== currentSection?.label
		) {
			return {
				firstChangedSectionIndex: index,
				previousSection,
				currentSection,
			};
		}
	}

	return {
		firstChangedSectionIndex: undefined,
		previousSection: previousSections[0],
		currentSection: currentSections[0],
	};
}

function formatSystemPromptChange(change: CacheTraceSystemPromptChange): string {
	const changedSection =
		change.firstChangedSectionIndex === undefined
			? 'firstChangedSection=unknown'
			: `firstChangedSection=${change.firstChangedSectionIndex}`;
	return (
		`${changedSection}` +
		` prev=${formatContentSectionSummary(change.previousSection)}` +
		` curr=${formatContentSectionSummary(change.currentSection)}` +
		` content=redacted`
	);
}

function formatContentSectionSummary(summary: CacheTraceContentSectionSummary | undefined): string {
	if (!summary) {
		return 'missing';
	}
	return (
		`${summary.label}#${summary.index}` +
		`:lines=${summary.startLine}-${summary.endLine}` +
		`:chars=${summary.chars}` +
		`:range=${summary.startChar}-${summary.endChar}` +
		`:hash=${summary.hash}`
	);
}

function summarizeMessages(messages: DeepSeekMessage[]): CacheTraceMessageSummary[] {
	const summaries: CacheTraceMessageSummary[] = [];
	let followsToolResult = false;
	for (const [index, message] of messages.entries()) {
		summaries.push(summarizeMessage(message, index, followsToolResult));
		if (message.role === 'tool') {
			followsToolResult = true;
		} else {
			followsToolResult = false;
		}
	}
	return summaries;
}

function summarizeMessage(
	message: DeepSeekMessage,
	index: number,
	followsToolResult: boolean,
): CacheTraceMessageSummary {
	const toolCallArgumentChars =
		message.tool_calls?.reduce((sum, toolCall) => sum + toolCall.function.arguments.length, 0) ?? 0;
	const reasoningChars = message.reasoning_content?.length ?? 0;
	const toolCalls = message.tool_calls?.length ?? 0;
	const assistantAfterToolResult = message.role === 'assistant' && followsToolResult;
	const afterToolResultKind = assistantAfterToolResult
		? toolCalls > 0
			? ('tool-call' as const)
			: ('final' as const)
		: ('none' as const);
	const hasReasoningContent = message.reasoning_content !== undefined;
	const hasEmptyReasoningContent = hasReasoningContent && reasoningChars === 0;
	const imageDescriptionCount = countLiteral(message.content, '[Image Description:');
	const unableImageCount = countLiteral(message.content, IMAGE_DESCRIPTION_UNAVAILABLE);
	const urlCount = countRegex(message.content, /https?:\/\//g);
	const codeFenceCount = countLiteral(message.content, '```');
	const likelyPathCount = countLikelyPaths(message.content);

	return {
		index,
		role: message.role,
		hash: hashString(stableStringify(message)),
		contentHash: hashString(message.content),
		contentHeadHash: hashString(message.content.slice(0, HASH_WINDOW_CHARS)),
		contentTailHash: hashString(message.content.slice(-HASH_WINDOW_CHARS)),
		contentChars: message.content.length,
		contentLines: countLines(message.content),
		imageDescriptionCount,
		unableImageCount,
		urlCount,
		codeFenceCount,
		likelyPathCount,
		toolCalls,
		toolCallArgumentChars,
		reasoningChars,
		emptyReasoning: hasEmptyReasoningContent,
		missingToolReasoning: message.role === 'assistant' && toolCalls > 0 && !hasReasoningContent,
		followsToolResult: assistantAfterToolResult,
		afterToolResultKind,
		missingPostToolReasoning: assistantAfterToolResult && !hasReasoningContent,
		missingPostToolCallReasoning: afterToolResultKind === 'tool-call' && !hasReasoningContent,
		missingPostToolFinalReasoning: afterToolResultKind === 'final' && !hasReasoningContent,
		contentSections: index === 0 ? summarizeSystemPromptSections(message.content) : undefined,
	};
}

interface ContentLineRange {
	text: string;
	startChar: number;
	endChar: number;
}

function summarizeSystemPromptSections(content: string): CacheTraceContentSectionSummary[] {
	const lines = getContentLineRanges(content);
	if (lines.length === 0) {
		return [];
	}

	const sections: CacheTraceContentSectionSummary[] = [];
	let sectionStart = 0;
	let sectionLabel = 'preamble';

	for (const [lineIndex, line] of lines.entries()) {
		const nextLabel = getSafeSystemPromptSectionLabel(line.text);
		if (!nextLabel) {
			continue;
		}

		if (lineIndex > sectionStart) {
			appendSystemPromptSectionWindows(
				sections,
				content,
				lines,
				sectionLabel,
				sectionStart,
				lineIndex,
			);
		}
		sectionStart = lineIndex;
		sectionLabel = nextLabel;
	}

	appendSystemPromptSectionWindows(
		sections,
		content,
		lines,
		sectionLabel,
		sectionStart,
		lines.length,
	);
	return sections;
}

function appendSystemPromptSectionWindows(
	sections: CacheTraceContentSectionSummary[],
	content: string,
	lines: readonly ContentLineRange[],
	label: string,
	startLineIndex: number,
	endLineIndex: number,
): void {
	for (
		let windowStart = startLineIndex;
		windowStart < endLineIndex;
		windowStart += SYSTEM_PROMPT_SECTION_MAX_LINES
	) {
		const windowEnd = Math.min(endLineIndex, windowStart + SYSTEM_PROMPT_SECTION_MAX_LINES);
		const startChar = lines[windowStart].startChar;
		const endChar = lines[windowEnd - 1].endChar;
		sections.push({
			index: sections.length,
			label,
			startLine: windowStart + 1,
			endLine: windowEnd,
			startChar,
			endChar,
			chars: endChar - startChar,
			hash: hashString(content.slice(startChar, endChar)),
		});
	}
}

function getContentLineRanges(content: string): ContentLineRange[] {
	if (content.length === 0) {
		return [];
	}

	const lines: ContentLineRange[] = [];
	let lineStart = 0;
	for (let index = 0; index < content.length; index += 1) {
		if (content.charAt(index) !== '\n') {
			continue;
		}
		const textEnd = index > lineStart && content.charAt(index - 1) === '\r' ? index - 1 : index;
		lines.push({
			text: content.slice(lineStart, textEnd),
			startChar: lineStart,
			endChar: index + 1,
		});
		lineStart = index + 1;
	}

	if (lineStart < content.length) {
		lines.push({
			text: content.slice(lineStart),
			startChar: lineStart,
			endChar: content.length,
		});
	}

	return lines;
}

function getSafeSystemPromptSectionLabel(line: string): string | undefined {
	const tag = /^\s*<([A-Za-z][\w-]*)\b/.exec(line)?.[1];
	if (!tag) {
		return undefined;
	}
	return SAFE_SYSTEM_PROMPT_TAGS.has(tag) ? `tag:${tag}` : 'tag:other';
}

function summarizeTools(tools: DeepSeekTool[]): CacheTraceToolSummary[] {
	return tools.map((tool, index) => ({
		index,
		name: tool.function.name,
		hash: hashString(stableStringify(tool)),
		descriptionHash: hashString(tool.function.description ?? ''),
		parametersHash: hashString(stableStringify(tool.function.parameters ?? null)),
	}));
}

function summarizeStats(messages: DeepSeekMessage[], toolCount: number): CacheTraceStats {
	let userMessages = 0;
	let assistantMessages = 0;
	let toolMessages = 0;
	let systemMessages = 0;
	let totalContentChars = 0;
	let toolCallArgumentChars = 0;
	let reasoningChars = 0;
	let largeMessages = 0;
	let assistantToolCallMessages = 0;
	let nonEmptyToolReasoningMessages = 0;
	let emptyToolReasoningMessages = 0;
	let missingToolReasoningMessages = 0;
	let assistantAfterToolResultMessages = 0;
	let assistantAfterToolResultToolCallMessages = 0;
	let assistantAfterToolResultFinalMessages = 0;
	let nonEmptyPostToolReasoningMessages = 0;
	let emptyPostToolReasoningMessages = 0;
	let missingPostToolReasoningMessages = 0;
	let nonEmptyPostToolCallReasoningMessages = 0;
	let emptyPostToolCallReasoningMessages = 0;
	let missingPostToolCallReasoningMessages = 0;
	let nonEmptyPostToolFinalReasoningMessages = 0;
	let emptyPostToolFinalReasoningMessages = 0;
	let missingPostToolFinalReasoningMessages = 0;
	let imageDescriptionMessages = 0;
	let imageDescriptionParts = 0;
	let unableImageMessages = 0;
	let urlMessages = 0;
	let urlCount = 0;
	let codeFenceMessages = 0;
	let codeFenceCount = 0;
	let likelyPathMessages = 0;
	let likelyPathCount = 0;
	let followsToolResult = false;

	for (const message of messages) {
		if (message.role === 'user') {
			userMessages += 1;
		} else if (message.role === 'assistant') {
			assistantMessages += 1;
		} else if (message.role === 'tool') {
			toolMessages += 1;
		} else if (message.role === 'system') {
			systemMessages += 1;
		}

		totalContentChars += message.content.length;
		if (message.content.length > LARGE_MESSAGE_CHARS) {
			largeMessages += 1;
		}

		const imageDescriptions = countLiteral(message.content, '[Image Description:');
		if (imageDescriptions > 0) {
			imageDescriptionMessages += 1;
			imageDescriptionParts += imageDescriptions;
		}
		if (message.content.includes(IMAGE_DESCRIPTION_UNAVAILABLE)) {
			unableImageMessages += 1;
		}

		const messageUrlCount = countRegex(message.content, /https?:\/\//g);
		if (messageUrlCount > 0) {
			urlMessages += 1;
			urlCount += messageUrlCount;
		}

		const messageCodeFenceCount = countLiteral(message.content, '```');
		if (messageCodeFenceCount > 0) {
			codeFenceMessages += 1;
			codeFenceCount += messageCodeFenceCount;
		}

		const messageLikelyPathCount = countLikelyPaths(message.content);
		if (messageLikelyPathCount > 0) {
			likelyPathMessages += 1;
			likelyPathCount += messageLikelyPathCount;
		}

		const toolCalls = message.tool_calls?.length ?? 0;
		const messageReasoningChars = message.reasoning_content?.length ?? 0;
		if (message.role === 'assistant' && followsToolResult) {
			assistantAfterToolResultMessages += 1;
			const isToolCallAfterToolResult = toolCalls > 0;
			if (isToolCallAfterToolResult) {
				assistantAfterToolResultToolCallMessages += 1;
			} else {
				assistantAfterToolResultFinalMessages += 1;
			}
			if (message.reasoning_content === undefined) {
				missingPostToolReasoningMessages += 1;
				if (isToolCallAfterToolResult) {
					missingPostToolCallReasoningMessages += 1;
				} else {
					missingPostToolFinalReasoningMessages += 1;
				}
			} else if (messageReasoningChars === 0) {
				emptyPostToolReasoningMessages += 1;
				if (isToolCallAfterToolResult) {
					emptyPostToolCallReasoningMessages += 1;
				} else {
					emptyPostToolFinalReasoningMessages += 1;
				}
			} else {
				nonEmptyPostToolReasoningMessages += 1;
				if (isToolCallAfterToolResult) {
					nonEmptyPostToolCallReasoningMessages += 1;
				} else {
					nonEmptyPostToolFinalReasoningMessages += 1;
				}
			}
		}

		if (toolCalls > 0) {
			assistantToolCallMessages += 1;
			if (message.reasoning_content === undefined) {
				missingToolReasoningMessages += 1;
			} else if (messageReasoningChars === 0) {
				emptyToolReasoningMessages += 1;
			} else {
				nonEmptyToolReasoningMessages += 1;
			}
			for (const toolCall of message.tool_calls ?? []) {
				toolCallArgumentChars += toolCall.function.arguments.length;
			}
		}

		reasoningChars += messageReasoningChars;

		if (message.role === 'tool') {
			followsToolResult = true;
		} else {
			followsToolResult = false;
		}
	}

	return {
		messageCount: messages.length,
		userMessages,
		assistantMessages,
		toolMessages,
		systemMessages,
		toolCount,
		totalContentChars,
		toolCallArgumentChars,
		reasoningChars,
		largeMessages,
		assistantToolCallMessages,
		nonEmptyToolReasoningMessages,
		emptyToolReasoningMessages,
		missingToolReasoningMessages,
		assistantAfterToolResultMessages,
		assistantAfterToolResultToolCallMessages,
		assistantAfterToolResultFinalMessages,
		nonEmptyPostToolReasoningMessages,
		emptyPostToolReasoningMessages,
		missingPostToolReasoningMessages,
		nonEmptyPostToolCallReasoningMessages,
		emptyPostToolCallReasoningMessages,
		missingPostToolCallReasoningMessages,
		nonEmptyPostToolFinalReasoningMessages,
		emptyPostToolFinalReasoningMessages,
		missingPostToolFinalReasoningMessages,
		imageDescriptionMessages,
		imageDescriptionParts,
		unableImageMessages,
		urlMessages,
		urlCount,
		codeFenceMessages,
		codeFenceCount,
		likelyPathMessages,
		likelyPathCount,
	};
}

function formatMessageSummary(summary: CacheTraceMessageSummary | undefined): string {
	if (!summary) {
		return 'missing';
	}
	let result =
		`${summary.role}#${summary.index}` +
		` chars=${summary.contentChars}` +
		` lines=${summary.contentLines}` +
		` toolCalls=${summary.toolCalls}` +
		` toolArgs=${summary.toolCallArgumentChars}` +
		` reasoning=${summary.reasoningChars}` +
		` emptyReasoning=${summary.emptyReasoning}`;
	const markers = formatRelevantMarkerSummary(summary);
	if (markers) {
		result += ` markers=${markers}`;
	}
	if (summary.followsToolResult) {
		result += ` afterToolResultKind=${summary.afterToolResultKind}`;
	}
	return result;
}

function formatRelevantMarkerSummary(summary: CacheTraceMessageSummary): string {
	const markers: string[] = [];
	appendNumberIfNonZero(markers, 'imageDesc', summary.imageDescriptionCount);
	appendNumberIfNonZero(markers, 'unableImage', summary.unableImageCount);
	appendNumberIfNonZero(markers, 'url', summary.urlCount);
	appendNumberIfNonZero(markers, 'codeFence', summary.codeFenceCount);
	return markers.join(',');
}

function formatChangedTool(comparison: CacheTraceComparison): string {
	if (comparison.firstChangedToolIndex === undefined) {
		return 'none';
	}
	return (
		`${comparison.firstChangedToolIndex}` +
		` prev=${formatToolSummary(comparison.previousTool)}` +
		` curr=${formatToolSummary(comparison.currentTool)}`
	);
}

function formatToolSummary(summary: CacheTraceToolSummary | undefined): string {
	if (!summary) {
		return 'missing';
	}
	return (
		`${summary.name}#${summary.index}` +
		` hash=${summary.hash}` +
		` desc=${summary.descriptionHash}` +
		` params=${summary.parametersHash}`
	);
}

function findFirstChangedMessageIndex(
	previous: CacheTraceMessageSummary[],
	current: CacheTraceMessageSummary[],
): number | undefined {
	const maxLength = Math.max(previous.length, current.length);
	for (let index = 0; index < maxLength; index += 1) {
		if (previous[index]?.hash !== current[index]?.hash) {
			return index;
		}
	}
	return undefined;
}

function findFirstChangedToolIndex(
	previous: CacheTraceToolSummary[],
	current: CacheTraceToolSummary[],
): number | undefined {
	const maxLength = Math.max(previous.length, current.length);
	for (let index = 0; index < maxLength; index += 1) {
		if (previous[index]?.hash !== current[index]?.hash) {
			return index;
		}
	}
	return undefined;
}

function countCommonPrefixChars(a: string, b: string): number {
	const length = Math.min(a.length, b.length);
	let index = 0;
	while (index < length && a.charCodeAt(index) === b.charCodeAt(index)) {
		index += 1;
	}
	return index;
}

function countLiteral(value: string, needle: string): number {
	if (!needle) {
		return 0;
	}
	let count = 0;
	let index = value.indexOf(needle);
	while (index !== -1) {
		count += 1;
		index = value.indexOf(needle, index + needle.length);
	}
	return count;
}

function countRegex(value: string, regex: RegExp): number {
	return value.match(regex)?.length ?? 0;
}

function countLikelyPaths(value: string): number {
	return countRegex(value, /(?:^|\s)(?:[\w.-]+\/){1,}[\w.-]+/g);
}

function countLines(value: string): number {
	if (value.length === 0) {
		return 0;
	}
	return countLiteral(value, '\n') + 1;
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(',')}]`;
	}

	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, entryValue]) => entryValue !== undefined)
		.sort(([left], [right]) => left.localeCompare(right));
	return `{${entries
		.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
		.join(',')}}`;
}

function hashString(value: string): string {
	return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
