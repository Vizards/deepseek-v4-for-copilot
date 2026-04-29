import vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
	if (!channel) {
		channel = vscode.window.createOutputChannel('DeepSeek');
	}
	return channel;
}

function ts(): string {
	return new Date().toISOString().slice(11, 23);
}

function write(level: string, args: unknown[]): void {
	const text = args
		.map((a) => {
			if (typeof a === 'string') return a;
			if (a instanceof Error) return a.stack ?? a.message;
			try {
				return JSON.stringify(a);
			} catch {
				return String(a);
			}
		})
		.join(' ');
	getChannel().appendLine(`[${ts()}] [${level}] ${text}`);
}

export const logger = {
	info: (...args: unknown[]) => write('info', args),
	warn: (...args: unknown[]) => write('warn', args),
	error: (...args: unknown[]) => write('error', args),
	debug: (...args: unknown[]) => write('debug', args),
	show: () => getChannel().show(),
	dispose: () => {
		channel?.dispose();
		channel = undefined;
	},
};
