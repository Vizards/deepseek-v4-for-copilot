import type vscode from 'vscode';

export function getVSCodeVisionTargetChatSessionType(
	model: vscode.LanguageModelChat,
): string | undefined {
	// targetChatSessionType is a proposed/runtime VS Code property, so treat it as
	// best-effort metadata. Vendor exclusions remain the stable fallback.
	const value = (model as { targetChatSessionType?: unknown }).targetChatSessionType;
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
