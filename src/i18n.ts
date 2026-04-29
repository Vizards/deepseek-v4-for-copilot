import { env } from 'vscode';

/**
 * 轻量级国际化模块 —— 零外部依赖，跟随 VS Code 显示语言。
 *
 *  - en / en-US / en-* → 英文（默认）
 *  - zh-cn / zh / zh-*   → 简体中文
 */

function isZh(): boolean {
	const lang = env.language.toLowerCase();
	return lang === 'zh-cn' || lang === 'zh' || lang.startsWith('zh-');
}

// ---- 翻译字典 ----

type Translations = Record<string, string>;

const zh: Translations = {
	// 模型描述
	'model.flash.detail': '快速高效',
	'model.pro.detail': '深度推理',

	// API Key
	'auth.apiKeyRequired': '请先在命令面板运行 "DeepSeek: 设置 API Key" 配置密钥',
	'auth.apiKeyRequiredDetail': '请先配置 API Key',
	'auth.prompt': '请输入 DeepSeek API Key',
	'auth.placeholder': 'sk-...',
	'auth.emptyValidation': 'API Key 不能为空',
	'auth.prefixValidation': 'API Key 应以 "sk-" 开头',
	'auth.saved': 'API Key 已保存。',
	'auth.removed': 'API Key 已移除。',
	'auth.notConfigured': 'API Key 未配置，请在命令面板运行 "DeepSeek: 设置 API Key"',

	// Thinking Effort —— 模型选择器下拉标签，保留简短
	'thinking.none': '停用',
	'thinking.none.desc': '停用思考，响应更快',
	'thinking.high': '标准',
	'thinking.high.desc': '推荐日常使用',
	'thinking.max': '深度',
	'thinking.max.desc': '深度推理，适合复杂任务',

	// Vision
	'vision.noModel': '当前环境中无可用的语言模型',
	'vision.pickPlaceholder': '选择用于描述图片的模型（默认 {0}）',
	'vision.current': '当前',
	'vision.proxyUsing': '视觉代理：{0}',
	'vision.notFound': '未找到视觉模型 "{0}"',
	'vision.unavailable': '无可用视觉模型，图片已忽略',
	'vision.proxyError': '视觉代理异常：',
	'vision.unableToDescribe': '[图片无法识别]',

	// Extension
	'extension.activateFailed': 'DeepSeek 激活失败，请运行 "DeepSeek: 显示日志" 查看详情',
	'extension.deactivateFailed': 'DeepSeek 停用异常',
	'extension.welcomeFailed': '欢迎引导加载异常',

	// Status bar / context display
	'status.model': '模型',
	'status.thinking': '思考',
	'status.promptTokens': '输入 Token',
	'status.completionTokens': '输出 Token',
	'status.totalTokens': '合计 Token',
	'status.cacheHit': '缓存命中',
	'status.cacheMiss': '缓存未命中',
	'status.cacheRate': '缓存命中率',
	'status.charsPerToken': '字符/Token',
	'status.noData': '等待首次 API 调用…',
	'status.clickForDetail': '点击查看日志',

	// Log output
	'log.tokens': 'tokens: prompt={0} completion={1}',
	'log.cache': 'cache: hit={0} miss={1} rate={2}%',
	'log.charsPerToken': 'chars/tok={0}',
};

const en: Translations = {
	// Model descriptions
	'model.flash.detail': 'Fast, general-purpose model',
	'model.pro.detail': 'Most capable reasoning model',

	// API Key
	'auth.apiKeyRequired': 'Please run "DeepSeek: Set API Key" to configure.',
	'auth.apiKeyRequiredDetail': 'Please run DeepSeek: Set API Key to configure.',
	'auth.prompt': 'Enter your DeepSeek API key',
	'auth.placeholder': 'sk-...',
	'auth.emptyValidation': 'API key cannot be empty',
	'auth.prefixValidation': 'API key should start with "sk-"',
	'auth.saved': 'DeepSeek API key saved securely.',
	'auth.removed': 'DeepSeek API key removed.',
	'auth.notConfigured': 'DeepSeek API key not configured. Run "DeepSeek: Set API Key" from the Command Palette.',

	// Thinking Effort
	'thinking.none': 'None',
	'thinking.none.desc': 'Disable thinking for faster responses',
	'thinking.high': 'High',
	'thinking.high.desc': 'Recommended for most tasks',
	'thinking.max': 'Max',
	'thinking.max.desc': 'Maximum reasoning depth for complex agent tasks',

	// Vision
	'vision.noModel': 'No language models available in your VS Code environment.',
	'vision.pickPlaceholder': 'Pick a model to describe image attachments (default: {0})',
	'vision.current': 'current',
	'vision.proxyUsing': 'Using vision proxy model: {0}',
	'vision.notFound': 'Vision model "{0}" not found.',
	'vision.unavailable': 'No vision model available; images will be dropped.',
	'vision.proxyError': 'Vision proxy error:',
	'vision.unableToDescribe': '[Image: unable to describe]',

	// Extension
	'extension.activateFailed': 'DeepSeek failed to activate. Run "DeepSeek: Show Logs" for details.',
	'extension.deactivateFailed': 'Failed to prepare DeepSeek provider for deactivate',
	'extension.welcomeFailed': 'Failed to show DeepSeek welcome prompt',

	// Status bar / context display
	'status.model': 'Model',
	'status.thinking': 'Thinking',
	'status.promptTokens': 'Prompt Tokens',
	'status.completionTokens': 'Completion Tokens',
	'status.totalTokens': 'Total Tokens',
	'status.cacheHit': 'Cache Hit',
	'status.cacheMiss': 'Cache Miss',
	'status.cacheRate': 'Cache Hit Rate',
	'status.charsPerToken': 'Chars/Token',
	'status.noData': 'Waiting for first API call...',
	'status.clickForDetail': 'Click for details',

	// Log output
	'log.tokens': 'tokens: prompt={0} completion={1}',
	'log.cache': 'cache: hit={0} miss={1} rate={2}%',
	'log.charsPerToken': 'chars/tok={0}',
};

/**
 * 获取翻译文本。支持 {0}, {1}, ... 占位符替换。
 */
export function t(key: string, ...args: (string | number)[]): string {
	const dict = isZh() ? zh : en;
	let text = dict[key] ?? en[key] ?? key;

	for (let i = 0; i < args.length; i++) {
		text = text.replace(`{${i}}`, String(args[i]));
	}

	return text;
}

/**
 * 检查当前是否为中文环境。
 */
export function isZhLocale(): boolean {
	return isZh();
}
