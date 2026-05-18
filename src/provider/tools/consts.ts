// DeepSeek Chat Completions API: "A max of 128 functions are supported."
// https://api-docs.deepseek.com/api/create-chat-completion#:~:text=A%20max%20of%20128%20functions%20are%20supported.
export const DEEPSEEK_TOOLS_LIMIT = 128;

export const ACTIVATE_TOOL_PREFIX = 'activate_';
export const PREFLIGHT_ACTIVATE_CALL_ID_PREFIX = 'deepseek_preflight_activate_';
export const MAX_PREFLIGHT_ROUNDS_PER_USER_REQUEST = 3;

export const TOOL_DRIFT_NOTICE_START = '[deepseek-copilot-tool-drift-notice-start]: #';
export const TOOL_DRIFT_NOTICE_END = '[deepseek-copilot-tool-drift-notice-end]: #';
