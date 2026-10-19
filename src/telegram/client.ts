import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { DEFAULT_API_SERVER } from '../constants';
import { ConfigError, errorMessage } from '../errors';
import { delay } from '../utils/async';
import { NetworkError, TelegramApiError } from './errors';
import { buildMultipart, type UploadFile } from './multipart';
import type { TgChat, TgChatMember, TgFile, TgMessage, TgResponse, TgUpdate, TgUser } from './types';

export type RequestFn = (request: RequestUrlParam) => Promise<RequestUrlResponse>;
export type Params = Record<string, unknown>;
export type FileUpload = Omit<UploadFile, 'field'>;

export interface ClientConfig {
	token: string;
	apiServer: string;
}

export interface ClientOptions {
	/** Minimum gap between two sending requests. Telegram asks bots to send about one message per second to a chat. */
	minSendIntervalMs: number;
	/** Retries after rate limiting (HTTP 429) or server errors (HTTP 5xx). */
	maxRetries: number;
	/** Retries when the request itself fails, for example while offline. */
	maxNetworkRetries: number;
	/** Longest `retry_after` the client is willing to wait for. */
	maxRetryAfterSeconds: number;
	/** Called when Telegram reports that a group became a supergroup with a new ID. */
	onChatMigrated?: (oldChatId: string, newChatId: string) => void;
	sleep: (ms: number) => Promise<void>;
}

interface PreparedRequest {
	param: RequestUrlParam;
	token: string;
}

/** Methods that post or change messages. They are queued and spaced out to respect rate limits. */
const SENDING_METHODS = new Set(['sendMessage', 'sendDocument', 'editMessageText', 'editMessageMedia', 'deleteMessages']);

export function normalizeApiServer(server: string): string {
	return server.trim().replace(/\/+$/, '') || DEFAULT_API_SERVER;
}

function parseResponse<T>(response: RequestUrlResponse): TgResponse<T> | null {
	try {
		const parsed = JSON.parse(response.text) as unknown;
		if (parsed !== null && typeof parsed === 'object' && 'ok' in parsed) return parsed as TgResponse<T>;
	} catch {
		// Not JSON, for example an HTML error page from a proxy.
	}
	return null;
}

/**
 * Minimal Telegram Bot API client built on Obsidian's `requestUrl`, which works
 * on desktop and mobile and is not subject to CORS.
 */
export class TelegramClient {
	private readonly options: ClientOptions;
	private lastSendAt = 0;
	private sendQueue: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly getConfig: () => ClientConfig,
		private readonly request: RequestFn,
		options: Partial<ClientOptions> = {},
	) {
		this.options = {
			minSendIntervalMs: options.minSendIntervalMs ?? 1000,
			maxRetries: options.maxRetries ?? 4,
			maxNetworkRetries: options.maxNetworkRetries ?? 2,
			maxRetryAfterSeconds: options.maxRetryAfterSeconds ?? 120,
			onChatMigrated: options.onChatMigrated,
			sleep: options.sleep ?? delay,
		};
	}

	getMe(): Promise<TgUser> {
		return this.call<TgUser>('getMe');
	}

	getChat(chatId: string): Promise<TgChat> {
		return this.call<TgChat>('getChat', { chat_id: chatId });
	}

	getChatMember(chatId: string, userId: number): Promise<TgChatMember> {
		return this.call<TgChatMember>('getChatMember', { chat_id: chatId, user_id: userId });
	}

	getUpdates(): Promise<TgUpdate[]> {
		return this.call<TgUpdate[]>('getUpdates', { limit: 100, timeout: 0 });
	}

	sendMessage(params: Params): Promise<TgMessage> {
		return this.call<TgMessage>('sendMessage', params);
	}

	sendDocument(params: Params, file: FileUpload): Promise<TgMessage> {
		return this.call<TgMessage>('sendDocument', params, [{ field: 'document', ...file }]);
	}

	editMessageText(params: Params): Promise<TgMessage | true> {
		return this.call<TgMessage | true>('editMessageText', params);
	}

	/** Replaces the file (and caption) of an existing document message. */
	editMessageMedia(chatId: string, messageId: number, file: FileUpload, caption?: { text: string; html: boolean }): Promise<TgMessage | true> {
		const media: Params = { type: 'document', media: 'attach://document', disable_content_type_detection: true };
		if (caption) {
			media.caption = caption.text;
			if (caption.html) media.parse_mode = 'HTML';
		}
		return this.call<TgMessage | true>('editMessageMedia', { chat_id: chatId, message_id: messageId, media }, [
			{ field: 'document', ...file },
		]);
	}

	deleteMessages(chatId: string, messageIds: number[]): Promise<boolean> {
		return this.call<boolean>('deleteMessages', { chat_id: chatId, message_ids: messageIds });
	}

	getFile(fileId: string): Promise<TgFile> {
		return this.call<TgFile>('getFile', { file_id: fileId });
	}

	/** Downloads a file returned by {@link getFile}. Bots can download files of up to 20 MB. */
	async downloadFile(filePath: string): Promise<ArrayBuffer> {
		const { token, apiServer } = this.getConfig();
		if (!token) throw new ConfigError('Add your bot token in the plugin settings first.');
		const path = filePath.split('/').map(encodeURIComponent).join('/');
		let response: RequestUrlResponse;
		try {
			response = await this.request({ url: `${normalizeApiServer(apiServer)}/file/bot${token}/${path}`, method: 'GET', throw: false });
		} catch (error) {
			throw new NetworkError(redact(errorMessage(error), token));
		}
		if (response.status !== 200) {
			throw new TelegramApiError('downloadFile', response.status, `HTTP ${response.status}`);
		}
		return response.arrayBuffer;
	}

	/** Calls any Bot API method. Sending methods are queued so they never overlap. */
	call<T>(method: string, params: Params = {}, files: UploadFile[] = []): Promise<T> {
		if (!SENDING_METHODS.has(method)) return this.execute<T>(method, params, files);
		const run = this.sendQueue.then(() => this.execute<T>(method, params, files));
		this.sendQueue = run.catch(() => undefined);
		return run;
	}

	private async execute<T>(method: string, params: Params, files: UploadFile[]): Promise<T> {
		const sending = SENDING_METHODS.has(method);
		let currentParams = params;
		let prepared = this.prepare(method, currentParams, files);
		let attempts = 0;
		let networkAttempts = 0;

		for (;;) {
			if (sending) await this.waitForSendSlot();
			let response: RequestUrlResponse;
			try {
				response = await this.request(prepared.param);
			} catch (error) {
				if (sending) this.lastSendAt = Date.now();
				if (networkAttempts < this.options.maxNetworkRetries) {
					networkAttempts++;
					await this.options.sleep(1500 * networkAttempts);
					continue;
				}
				throw new NetworkError(redact(errorMessage(error), prepared.token));
			}
			if (sending) this.lastSendAt = Date.now();

			const body = parseResponse<T>(response);
			if (body?.ok) return body.result as T;

			const code = body?.error_code ?? response.status;
			const description = redact(body?.description ?? `HTTP ${response.status}`, prepared.token);
			const retryAfter = body?.parameters?.retry_after;
			const migrateTo = body?.parameters?.migrate_to_chat_id;
			const chatId = currentParams.chat_id;

			if (migrateTo !== undefined && (typeof chatId === 'string' || typeof chatId === 'number') && attempts < this.options.maxRetries) {
				attempts++;
				const newChatId = String(migrateTo);
				this.options.onChatMigrated?.(String(chatId), newChatId);
				currentParams = { ...currentParams, chat_id: newChatId };
				prepared = this.prepare(method, currentParams, files);
				continue;
			}
			if (code === 429 && attempts < this.options.maxRetries && (retryAfter ?? 0) <= this.options.maxRetryAfterSeconds) {
				attempts++;
				await this.options.sleep(((retryAfter ?? 3) + 1) * 1000);
				continue;
			}
			if (code >= 500 && attempts < this.options.maxRetries) {
				attempts++;
				await this.options.sleep(2000 * attempts);
				continue;
			}
			throw new TelegramApiError(method, code, description, retryAfter);
		}
	}

	private prepare(method: string, params: Params, files: UploadFile[]): PreparedRequest {
		const { token, apiServer } = this.getConfig();
		if (!token) throw new ConfigError('Add your bot token in the plugin settings first.');
		const url = `${normalizeApiServer(apiServer)}/bot${token}/${method}`;
		if (files.length === 0) {
			return { token, param: { url, method: 'POST', contentType: 'application/json', body: JSON.stringify(params), throw: false } };
		}
		const fields: Record<string, string> = {};
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined || value === null) continue;
			fields[key] = typeof value === 'string' ? value : JSON.stringify(value);
		}
		const { body, contentType } = buildMultipart(fields, files);
		return { token, param: { url, method: 'POST', contentType, body, throw: false } };
	}

	private async waitForSendSlot(): Promise<void> {
		const wait = this.lastSendAt + this.options.minSendIntervalMs - Date.now();
		if (wait > 0) await this.options.sleep(wait);
	}
}

/** Never let the bot token leak into error messages or logs. */
function redact(text: string, token: string): string {
	return token ? text.split(token).join('<bot-token>') : text;
}
