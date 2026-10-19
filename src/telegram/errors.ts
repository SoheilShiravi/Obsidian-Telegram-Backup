/** A request reached Telegram and Telegram answered with an error. */
export class TelegramApiError extends Error {
	readonly method: string;
	readonly code: number;
	readonly description: string;
	readonly retryAfter?: number;

	constructor(method: string, code: number, description: string, retryAfter?: number) {
		super(friendlyTelegramMessage(code, description, retryAfter));
		this.name = 'TelegramApiError';
		this.method = method;
		this.code = code;
		this.description = description;
		this.retryAfter = retryAfter;
	}
}

/** The request never reached Telegram (offline, blocked network, wrong server address…). */
export class NetworkError extends Error {
	readonly detail: string;

	constructor(detail: string) {
		super(
			'Could not reach Telegram. Check your internet connection, VPN or proxy, and the Bot API server in the plugin settings.' +
				(detail ? ` (${detail})` : ''),
		);
		this.name = 'NetworkError';
		this.detail = detail;
	}
}

/** Turns Bot API error descriptions into actionable messages. */
export function friendlyTelegramMessage(code: number, description: string, retryAfter?: number): string {
	const d = description.toLowerCase();
	if (code === 401 || d.includes('unauthorized')) {
		return 'Telegram rejected the bot token. Check the token in the plugin settings.';
	}
	if (d.includes('chat not found')) {
		return 'Chat not found. Check the chat ID and make sure the bot was added to the channel or group.';
	}
	if (
		d.includes('bot was kicked') ||
		d.includes('not a member') ||
		d.includes('need administrator rights') ||
		d.includes('not enough rights') ||
		d.includes('have no rights')
	) {
		return 'The bot is not allowed to post in this chat. Make it an administrator with permission to post messages.';
	}
	if (d.includes("can't initiate conversation") || d.includes('bot was blocked by the user')) {
		return 'Open your bot in Telegram and press Start, then try again.';
	}
	if (d.includes('thread not found') || d.includes('topic_deleted') || d.includes('topic_closed')) {
		return 'The topic ID is not valid for this chat.';
	}
	if (code === 413 || d.includes('too large') || d.includes('file is too big')) {
		return 'The file is too large. Telegram bots can upload files of up to 50 MB and download files of up to 20 MB.';
	}
	if (code === 409) {
		return 'Another app is receiving updates for this bot, or a webhook is set, so chats cannot be detected. Enter the chat ID manually.';
	}
	if (code === 429) {
		return `Telegram is limiting how fast this bot can send messages. Try again in ${retryAfter ?? 30} seconds.`;
	}
	return `Telegram error ${code}: ${description}`;
}

function describes(error: unknown, pattern: RegExp): boolean {
	return error instanceof TelegramApiError && pattern.test(error.description);
}

/** Telegram could not parse the HTML formatting of a message or caption. */
export function isParseError(error: unknown): boolean {
	return describes(error, /can't parse entities|can't find end of|unsupported start tag|unexpected end tag|unclosed start tag|entity beginning|wrong.*entit/i);
}

/** An edit was rejected because nothing changed. */
export function isNotModifiedError(error: unknown): boolean {
	return describes(error, /message is not modified/i);
}
