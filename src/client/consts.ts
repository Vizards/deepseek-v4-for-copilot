import type {
	ApiProviderId,
	HttpErrorLinkDefinition,
	HttpErrorLinkStatusKey,
	NetworkErrorCategory,
} from './types';
import { EXTERNAL_URLS } from '../consts';

export const MAX_DIAGNOSTIC_FIELD_LENGTH = 300;

export const API_PROVIDER_HTTP_ERROR_LINKS: Readonly<
	Record<HttpErrorLinkStatusKey, Readonly<Partial<Record<ApiProviderId, HttpErrorLinkDefinition>>>>
> = {
	401: {
		deepseek: {
			labelKey: 'error.action.createApiKey',
			url: EXTERNAL_URLS.deepseek.apiKeys,
		},
	},
	402: {
		deepseek: {
			labelKey: 'error.action.viewUsage',
			url: EXTERNAL_URLS.deepseek.usage,
		},
	},
	'5xx': {
		deepseek: {
			labelKey: 'error.action.checkDeepSeekStatus',
			url: EXTERNAL_URLS.deepseek.status,
		},
	},
};

/**
 * Curated network error codes observed from Node.js fetch failures.
 *
 * Sources: Node errno / c-ares DNS codes (`NodeJS.ErrnoException.code`),
 * Node TLS/OpenSSL error codes, and undici error `code` / `name` literals
 * from the `undici-types` package bundled through `@types/node`.
 *
 * This is intentionally not exhaustive: unknown codes fall back to `generic`
 * while still being shown to the user in the error message.
 */
export const NETWORK_ERROR_CATEGORY_BY_CODE = {
	ENOTFOUND: 'dns',
	EAI_AGAIN: 'dns',
	ENODATA: 'dns',
	ESERVFAIL: 'dns',
	EFORMERR: 'dns',
	ENONAME: 'dns',
	EBADNAME: 'dns',
	EBADQUERY: 'dns',
	EBADFAMILY: 'dns',
	EBADRESP: 'dns',
	ENOTIMP: 'dns',
	EREFUSED: 'dns',
	ENOTINITIALIZED: 'dns',
	ELOADIPHLPAPI: 'dns',
	EADDRGETNETWORKPARAMS: 'dns',
	ECONNREFUSED: 'unreachable',
	ENETUNREACH: 'unreachable',
	EHOSTUNREACH: 'unreachable',
	EADDRNOTAVAIL: 'unreachable',
	ENETDOWN: 'unreachable',
	EHOSTDOWN: 'unreachable',
	ECONNRESET: 'interrupted',
	ECONNABORTED: 'interrupted',
	ENETRESET: 'interrupted',
	ENOTCONN: 'interrupted',
	EPIPE: 'interrupted',
	EOF: 'interrupted',
	UND_ERR_SOCKET: 'interrupted',
	SocketError: 'interrupted',
	ETIMEDOUT: 'timeout',
	ETIMEOUT: 'timeout',
	ESOCKETTIMEDOUT: 'timeout',
	UND_ERR_CONNECT_TIMEOUT: 'timeout',
	UND_ERR_HEADERS_TIMEOUT: 'timeout',
	UND_ERR_BODY_TIMEOUT: 'timeout',
	ERR_TLS_HANDSHAKE_TIMEOUT: 'timeout',
	TimeoutError: 'timeout',
	ConnectTimeoutError: 'timeout',
	HeadersTimeoutError: 'timeout',
	BodyTimeoutError: 'timeout',
	CERT_HAS_EXPIRED: 'tls',
	CERT_NOT_YET_VALID: 'tls',
	CERT_UNTRUSTED: 'tls',
	CERT_REJECTED: 'tls',
	CERT_SIGNATURE_FAILURE: 'tls',
	SELF_SIGNED_CERT_IN_CHAIN: 'tls',
	DEPTH_ZERO_SELF_SIGNED_CERT: 'tls',
	UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'tls',
	UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'tls',
	UNABLE_TO_GET_ISSUER_CERT: 'tls',
	UNABLE_TO_GET_CRL: 'tls',
	UNABLE_TO_DECRYPT_CERT_SIGNATURE: 'tls',
	UNABLE_TO_DECRYPT_CRL_SIGNATURE: 'tls',
	UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY: 'tls',
	CRL_SIGNATURE_FAILURE: 'tls',
	ERR_TLS_CERT_ALTNAME_INVALID: 'tls',
	UND_ERR_PRX_TLS: 'tls',
	SecureProxyConnectionError: 'tls',
	ABORT_ERR: 'aborted',
	AbortError: 'aborted',
	UND_ERR_ABORTED: 'aborted',
	ECANCELLED: 'aborted',
	UND_ERR_HEADERS_OVERFLOW: 'protocol',
	UND_ERR_RESPONSE: 'protocol',
	UND_ERR_REQ_CONTENT_LENGTH_MISMATCH: 'protocol',
	UND_ERR_RES_CONTENT_LENGTH_MISMATCH: 'protocol',
	UND_ERR_RES_EXCEEDED_MAX_SIZE: 'protocol',
	HTTPParserError: 'protocol',
	HeadersOverflowError: 'protocol',
	ResponseError: 'protocol',
	ResponseContentLengthMismatchError: 'protocol',
	ResponseExceededMaxSizeError: 'protocol',
	ERR_INVALID_URL: 'configuration',
	ERR_INVALID_ARG_TYPE: 'configuration',
	ERR_INVALID_ARG_VALUE: 'configuration',
	UND_ERR_INVALID_ARG: 'configuration',
	InvalidArgumentError: 'configuration',
} as const satisfies Record<string, NetworkErrorCategory>;
