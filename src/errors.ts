/** An error whose message is written for the user and can be shown as-is. */
export class UserError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UserError';
	}
}

/** The bot token or chat ID is missing. */
export class ConfigError extends UserError {
	constructor(message: string) {
		super(message);
		this.name = 'ConfigError';
	}
}

/** The user cancelled a running backup. */
export class CancelledError extends Error {
	constructor() {
		super('The backup was cancelled.');
		this.name = 'CancelledError';
	}
}

/** Best-effort conversion of anything thrown into a readable message. */
export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	if (typeof error === 'number' || typeof error === 'boolean') return String(error);
	try {
		return JSON.stringify(error);
	} catch {
		return 'Unknown error';
	}
}
