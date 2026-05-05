import vscode from 'vscode';

export type PendingVisionDescriptionResult =
	| { cancelled: true }
	| { cancelled: false; description: string };

type StartPendingVisionDescription = (token: vscode.CancellationToken) => Promise<string>;

interface PendingVisionDescriptionOptions {
	start: StartPendingVisionDescription;
	onDescription: (description: string) => void;
	onError: (err: unknown) => void;
}

export class PendingVisionDescription {
	private readonly tokenSource = new vscode.CancellationTokenSource();
	private activeWaiters = 0;
	private settled = false;
	private cancelledWhenUnusedValue = false;
	readonly promise: Promise<string>;

	constructor(options: PendingVisionDescriptionOptions) {
		this.promise = options
			.start(this.tokenSource.token)
			.then(
				(description) => {
					options.onDescription(description);
					return description;
				},
				(err: unknown) => {
					if (!this.cancelledWhenUnusedValue) {
						options.onError(err);
					}
					throw err;
				},
			)
			.finally(() => {
				this.settled = true;
				this.tokenSource.dispose();
			});
	}

	get cancelledWhenUnused(): boolean {
		return this.cancelledWhenUnusedValue;
	}

	wait(token: vscode.CancellationToken): Promise<PendingVisionDescriptionResult> {
		this.acquire();
		let released = false;
		let cancellation: vscode.Disposable | undefined;
		const release = () => {
			if (released) {
				return;
			}
			released = true;
			cancellation?.dispose();
			this.release();
		};

		if (token.isCancellationRequested) {
			release();
			return Promise.resolve({ cancelled: true });
		}

		return new Promise((resolve, reject) => {
			cancellation = token.onCancellationRequested(() => {
				release();
				resolve({ cancelled: true });
			});
			this.promise.then(
				(description) => {
					release();
					resolve({ cancelled: false, description });
				},
				(err: unknown) => {
					release();
					reject(err);
				},
			);
		});
	}

	private acquire(): void {
		this.activeWaiters += 1;
	}

	private release(): void {
		if (this.activeWaiters > 0) {
			this.activeWaiters -= 1;
		}
		if (this.activeWaiters === 0 && !this.settled) {
			this.cancelledWhenUnusedValue = true;
			this.tokenSource.cancel();
		}
	}
}
