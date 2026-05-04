import vscode from 'vscode';

export function estimateTokenCount(
	text: string | vscode.LanguageModelChatRequestMessage,
	charsPerToken: number,
): number {
	if (typeof text === 'string') {
		return Math.max(1, Math.ceil(text.length / charsPerToken));
	}

	if (!text?.content || !Array.isArray(text.content)) {
		return 1;
	}

	let total = 0;
	for (const part of text.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			total += part.value.length;
		}
	}
	return Math.max(1, Math.ceil(total / charsPerToken));
}
