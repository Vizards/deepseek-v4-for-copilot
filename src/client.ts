import type { CancellationToken } from 'vscode';
import { logger } from './logger';
import type {
	DeepSeekRequest,
	DeepSeekStreamChunk,
	DeepSeekToolCall,
	StreamCallbacks,
} from './types';

/**
 * Lightweight SSE-streaming DeepSeek API client.
 * No external dependencies — uses Node's built-in fetch.
 */
export class DeepSeekClient {
	constructor(
		private readonly baseUrl: string,
		private readonly apiKey: string,
	) {}

	/**
	 * Stream a chat completion from the DeepSeek API.
	 * Parses SSE chunks and dispatches callbacks for content, thinking, and tool calls.
	 */
	async streamChatCompletion(
		request: DeepSeekRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: CancellationToken,
	): Promise<void> {
		const controller = new AbortController();

		const cancelListener = cancellationToken?.onCancellationRequested(() => {
			controller.abort();
		});

		try {
			// Request usage stats in streaming responses so we can calibrate token counting.
			const requestBody = {
				...request,
				stream_options: { include_usage: true },
			};

			const response = await fetch(`${this.baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify(requestBody),
				signal: controller.signal,
			});

			if (!response.ok) {
				const errorText = await response.text();
				let errorMessage: string;
				try {
					const errorJson = JSON.parse(errorText);
					errorMessage = errorJson.error?.message || errorJson.message || errorText;
				} catch {
					errorMessage = errorText;
				}
				throw new Error(`DeepSeek API error (${response.status}): ${errorMessage}`);
			}

			if (!response.body) {
				throw new Error('No response body received');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			// Accumulate tool call deltas by index, then emit on finish_reason=stop/tool_calls
			const pendingToolCalls = new Map<number, DeepSeekToolCall>();

			while (true) {
				if (cancellationToken?.isCancellationRequested) {
					controller.abort();
					break;
				}

				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });

				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();

					if (!trimmed || trimmed.startsWith(':')) {
						continue;
					}

					if (trimmed === 'data: [DONE]') {
						// Flush any remaining tool calls
						for (const tc of pendingToolCalls.values()) {
							callbacks.onToolCall(tc);
						}
						pendingToolCalls.clear();
						callbacks.onDone();
						return;
					}

					if (!trimmed.startsWith('data: ')) {
						continue;
					}

					const jsonStr = trimmed.slice(6);
					try {
						const chunk: DeepSeekStreamChunk = JSON.parse(jsonStr);
						const choice = chunk.choices?.[0];

						// Capture usage stats from the API for token-count calibration.
						if (chunk.usage && callbacks.onUsage) {
							callbacks.onUsage(chunk.usage);
						}

						if (!choice) {
							continue;
						}

						// Thinking content → report with correct field name so VS Code renders collapsible blocks
						const reasoning = choice.delta.reasoning_content;
						if (reasoning) {
							callbacks.onThinking(reasoning);
						}

						// Regular content
						if (choice.delta.content) {
							callbacks.onContent(choice.delta.content);
						}

						// Tool calls — accumulate deltas by index
						if (choice.delta.tool_calls) {
							for (const tc of choice.delta.tool_calls) {
								let pending = pendingToolCalls.get(tc.index);
								if (!pending && tc.id) {
									pending = {
										id: tc.id,
										type: 'function',
										function: { name: '', arguments: '' },
									};
									pendingToolCalls.set(tc.index, pending);
								}
								if (pending) {
									if (tc.function?.name) {
										pending.function.name += tc.function.name;
									}
									if (tc.function?.arguments) {
										pending.function.arguments += tc.function.arguments;
									}
								}
							}
						}

						// Flush pending tool calls on finish
						if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
							for (const tc of pendingToolCalls.values()) {
								callbacks.onToolCall(tc);
							}
							pendingToolCalls.clear();
						}
					} catch (e) {
						logger.error('Failed to parse SSE chunk:', jsonStr.slice(0, 200), e);
					}
				}
			}

			callbacks.onDone();
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				callbacks.onDone();
				return;
			}
			callbacks.onError(error instanceof Error ? error : new Error(String(error)));
		} finally {
			cancelListener?.dispose();
		}
	}
}
