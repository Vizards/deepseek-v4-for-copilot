import type { DeepSeekRequest } from '../types';

export interface ErrorActionUrls {
	configureApiKey?: string;
	showLogs?: string;
}

export interface RequestErrorContext {
	baseUrl: string;
	request: DeepSeekRequest;
}

export interface ErrorActionLink {
	labelKey: string;
	url: string;
}

export interface HttpErrorLinkDefinition {
	labelKey: string;
	url: string;
}

export type ApiProviderId = 'deepseek';
export type HttpErrorLinkStatusKey = 401 | 402 | '5xx';

export type DeepSeekRequestErrorKind = 'http' | 'network' | 'unknown';

export type NetworkErrorCategory =
	| 'dns'
	| 'unreachable'
	| 'interrupted'
	| 'timeout'
	| 'tls'
	| 'aborted'
	| 'protocol'
	| 'configuration'
	| 'generic';
