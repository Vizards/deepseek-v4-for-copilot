import vscode from 'vscode';

/**
 * Lightweight i18n module — zero dependencies, follows VS Code display language.
 *
 *  - en / en-US / en-*      → English (default)
 *  - zh-cn                  → Simplified Chinese
 *  - all other locales      → English until translated
 */

function isZh(): boolean {
	const lang = vscode.env.language.toLowerCase();
	return lang === 'zh-cn';
}

// ---- Translation dictionaries ----

type Translations = Record<string, string>;

const zh: Translations = {
	// Model descriptions
	'model.flash.detail': '快速高效',
	'model.pro.detail': '深度推理',

	// API Key
	'auth.apiKeyRequiredDetail': '请先配置 API Key',
	'auth.prompt': '请输入 DeepSeek API Key 或兼容服务令牌。官方 DeepSeek Key 通常以 "sk-" 开头。',
	'auth.placeholder': 'sk-... 或服务商令牌',
	'auth.emptyValidation': 'API Key 不能为空',
	'auth.saved': 'API Key 已安全保存。',
	'auth.removed': 'API Key 已移除。',
	'auth.notConfigured': 'API Key 未配置，请在命令面板运行 "DeepSeek: 设置 API Key"。',

	// Thinking Effort — short labels for model picker dropdown
	'status.thinking': '思考模式',
	'thinking.none': '停用',
	'thinking.none.desc': '停用思考，响应更快',
	'thinking.high': '标准',
	'thinking.high.desc': '推荐日常使用',
	'thinking.max': '深度',
	'thinking.max.desc': '深度推理，适合复杂任务',

	// Vision
	'vision.vendorLabel': '提供商：{0}',
	'vision.noModel': '当前环境中没有可用的非 DeepSeek 视觉代理模型。',
	'vision.pickPlaceholder': '选择用于描述图片的模型 (默认 {0})',
	'vision.current': '当前',
	'vision.proxyUsing': '视觉代理：{0}',
	'vision.notFound': '未找到视觉模型 "{0}"',
	'vision.unavailable': '无可用视觉模型，图片已忽略。',
	'vision.proxyError': '视觉代理异常：',

	// Extension
	'extension.activateFailed': 'DeepSeek 激活失败，请运行 "DeepSeek: 显示日志" 查看详情。',
	'extension.deactivateFailed': 'DeepSeek 停用异常',
	'extension.welcomeFailed': '欢迎引导加载异常',
};

const en: Translations = {
	// Model descriptions
	'model.flash.detail': 'Fast, general-purpose model',
	'model.pro.detail': 'Most capable reasoning model',

	// API Key
	'auth.apiKeyRequiredDetail': 'Please run DeepSeek: Set API Key to configure.',
	'auth.prompt':
		'Enter your DeepSeek API key or compatible provider token. Official DeepSeek keys usually start with "sk-".',
	'auth.placeholder': 'sk-... or provider token',
	'auth.emptyValidation': 'API key cannot be empty',
	'auth.saved': 'DeepSeek API key saved.',
	'auth.removed': 'DeepSeek API key removed.',
	'auth.notConfigured':
		'DeepSeek API key not configured. Run "DeepSeek: Set API Key" from the Command Palette.',

	// Thinking Effort
	'status.thinking': 'Thinking Effort',
	'thinking.none': 'None',
	'thinking.none.desc': 'Disable thinking for faster responses',
	'thinking.high': 'High',
	'thinking.high.desc': 'Recommended for most tasks',
	'thinking.max': 'Max',
	'thinking.max.desc': 'Maximum reasoning depth for complex agent tasks',

	// Vision
	// NOTE: vision.unableToDescribe has been moved to consts.ts as
	// IMAGE_DESCRIPTION_UNAVAILABLE — it is prompt content, not UI text.
	'vision.vendorLabel': 'vendor: {0}',
	'vision.noModel': 'No non-DeepSeek vision proxy models are available in the current environment',
	'vision.pickPlaceholder': 'Select a model for image description (default: {0})',
	'vision.current': 'Current',
	'vision.proxyUsing': 'Vision proxy: {0}',
	'vision.notFound': 'Vision model "{0}" not found',
	'vision.unavailable': 'No vision models available, image(s) ignored',
	'vision.proxyError': 'Vision proxy error:',

	// Extension
	'extension.activateFailed': 'DeepSeek failed to activate. Run "DeepSeek: Show Logs" for details.',
	'extension.deactivateFailed': 'Failed to prepare DeepSeek provider for deactivate',
	'extension.welcomeFailed': 'Failed to show DeepSeek welcome prompt',
};

/**
 * Resolve a translation key for the current VS Code display language.
 * Supports positional placeholders {0}, {1}, ...
 */
export function t(key: string, ...args: (string | number)[]): string {
	const dict = isZh() ? zh : en;
	let text = dict[key];
	if (text === undefined) {
		// Fall back to English when a key is missing from the active locale.
		text = en[key];
	}
	if (text === undefined) {
		return key;
	}
	// Replace all occurrences of each positional placeholder.
	for (let i = 0; i < args.length; i++) {
		text = text.replaceAll(`{${i}}`, String(args[i]));
	}
	return text;
}
