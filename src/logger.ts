import vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

function getChannel(): vscode.LogOutputChannel {
	if (!channel) {
		channel = vscode.window.createOutputChannel('DeepSeek', { log: true });
	}
	return channel;
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

/**
 * The channel is a host resource: creating it once the extension host has closed its RPC, or
 * writing to one the host already tore down, throws. A caller reporting a problem must not be
 * turned into a second problem, so a log call never throws and returns whether the line
 * actually reached the channel.
 */
function logLine(level: 'info' | 'warn' | 'error' | 'debug', args: unknown[]): boolean {
	try {
		const message = formatMessage(args);
		const target = getChannel();
		// Each branch returns from inside the case that wrote, so a level added to the union
		// later cannot report a write that never happened.
		switch (level) {
			case 'info':
				target.info(message);
				return true;
			case 'warn':
				target.warn(message);
				return true;
			case 'error':
				target.error(message);
				return true;
			case 'debug':
				target.debug(message);
				return true;
		}
	} catch {
		// A lost diagnostic is preferable to a failed request or a failed deactivation.
		return false;
	}
}

export const logger = {
	info: (...args: unknown[]) => logLine('info', args),
	warn: (...args: unknown[]) => logLine('warn', args),
	error: (...args: unknown[]) => logLine('error', args),
	debug: (...args: unknown[]) => logLine('debug', args),
	show: () => getChannel().show(),
	dispose: () => {
		try {
			channel?.dispose();
		} catch {
			// Releasing the channel must not fail the deactivation that called it.
		}
		channel = undefined;
	},
};
