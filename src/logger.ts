import vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

function getChannel(): vscode.LogOutputChannel {
	if (!channel) {
		channel = vscode.window.createOutputChannel('DeepSeek', { log: true });
	}
	return channel;
}

function ts(): string {
	return new Date().toISOString().slice(11, 23);
}

function formatMessage(args: unknown[]): string {
	return args
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
}

export const logger = {
	info: (...args: unknown[]) => getChannel().info(`[${ts()}]`, formatMessage(args)),
	warn: (...args: unknown[]) => getChannel().warn(`[${ts()}]`, formatMessage(args)),
	error: (...args: unknown[]) => getChannel().error(`[${ts()}]`, formatMessage(args)),
	debug: (...args: unknown[]) => getChannel().debug(`[${ts()}]`, formatMessage(args)),
	show: () => getChannel().show(),
	dispose: () => {
		channel?.dispose();
		channel = undefined;
	},
};
