import { CAPTION_LIMIT } from '../constants';
import { htmlToPlain, isValidTelegramHtml, visibleLength } from '../format/html';
import type TelegramBackupPlugin from '../main';
import type { FileUpload, Params } from '../telegram/client';
import { isNotModifiedError, isParseError } from '../telegram/errors';
import type { TgMessage } from '../telegram/types';
import { truncate } from '../utils/format';
import { mimeType } from '../utils/mime';

function canUseHtmlCaption(html: string): boolean {
	return visibleLength(html) <= CAPTION_LIMIT && isValidTelegramHtml(html);
}

function plainCaption(html: string): string {
	return truncate(htmlToPlain(html), CAPTION_LIMIT);
}

/**
 * Sends to the configured chat. Applies the message options from the settings
 * and falls back to plain text whenever Telegram rejects the HTML formatting.
 */
export class TelegramSender {
	constructor(private readonly plugin: TelegramBackupPlugin) {}

	private targetParams(): Params {
		const { chatId, topicId } = this.plugin.requireTarget();
		const { silentMessages, protectContent } = this.plugin.settings;
		return {
			chat_id: chatId,
			message_thread_id: topicId,
			disable_notification: silentMessages || undefined,
			protect_content: protectContent || undefined,
		};
	}

	async sendHtml(html: string, extra: Params = {}): Promise<TgMessage> {
		const { client } = this.plugin;
		const params = { ...this.targetParams(), link_preview_options: { is_disabled: true }, ...extra };
		try {
			return await client.sendMessage({ ...params, text: html, parse_mode: 'HTML' });
		} catch (error) {
			if (!isParseError(error)) throw error;
			return client.sendMessage({ ...params, text: htmlToPlain(html) });
		}
	}

	async sendDocument(fileName: string, data: Uint8Array, captionHtml?: string, extra: Params = {}): Promise<TgMessage> {
		const { client } = this.plugin;
		const file: FileUpload = { filename: fileName, data, contentType: mimeType(fileName) };
		const params = { ...this.targetParams(), disable_content_type_detection: true, ...extra };
		if (!captionHtml) return client.sendDocument(params, file);
		if (canUseHtmlCaption(captionHtml)) {
			try {
				return await client.sendDocument({ ...params, caption: captionHtml, parse_mode: 'HTML' }, file);
			} catch (error) {
				if (!isParseError(error)) throw error;
			}
		}
		return client.sendDocument({ ...params, caption: plainCaption(captionHtml) }, file);
	}

	/** Replaces the text of an earlier message. Unchanged text is not an error. */
	async editHtml(messageId: number, html: string): Promise<void> {
		const { client } = this.plugin;
		const { chatId } = this.plugin.requireTarget();
		const base = { chat_id: chatId, message_id: messageId, link_preview_options: { is_disabled: true } };
		try {
			await client.editMessageText({ ...base, text: html, parse_mode: 'HTML' });
		} catch (error) {
			if (isNotModifiedError(error)) return;
			if (!isParseError(error)) throw error;
			try {
				await client.editMessageText({ ...base, text: htmlToPlain(html) });
			} catch (retryError) {
				if (!isNotModifiedError(retryError)) throw retryError;
			}
		}
	}

	/** Replaces the file of an earlier document message. Returns the edited message when Telegram sends it back. */
	async editDocument(messageId: number, fileName: string, data: Uint8Array, captionHtml?: string): Promise<TgMessage | null> {
		const { client } = this.plugin;
		const { chatId } = this.plugin.requireTarget();
		const file: FileUpload = { filename: fileName, data, contentType: mimeType(fileName) };
		const asMessage = (result: TgMessage | true): TgMessage | null => (typeof result === 'object' ? result : null);
		if (captionHtml && canUseHtmlCaption(captionHtml)) {
			try {
				return asMessage(await client.editMessageMedia(chatId, messageId, file, { text: captionHtml, html: true }));
			} catch (error) {
				if (isNotModifiedError(error)) return null;
				if (!isParseError(error)) throw error;
			}
		}
		try {
			const caption = captionHtml ? { text: plainCaption(captionHtml), html: false } : undefined;
			return asMessage(await client.editMessageMedia(chatId, messageId, file, caption));
		} catch (error) {
			if (isNotModifiedError(error)) return null;
			throw error;
		}
	}

	/** Deletes earlier messages. Failures are ignored: the messages may already be gone. */
	async deleteMessages(messageIds: number[]): Promise<void> {
		if (messageIds.length === 0) return;
		try {
			const { chatId } = this.plugin.requireTarget();
			await this.plugin.client.deleteMessages(chatId, messageIds);
		} catch {
			// Telegram only lets bots delete messages for a limited time.
		}
	}
}
