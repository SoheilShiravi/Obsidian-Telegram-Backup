import { getAllTags, Platform, type TFile } from 'obsidian';
import { MAX_TEXT_MESSAGES, MESSAGE_CHUNK_LIMIT, MESSAGE_FILE_EXTENSIONS, TEXT_FILE_EXTENSIONS, UPLOAD_LIMIT_BYTES } from '../constants';
import { UserError } from '../errors';
import { chunkBlocks } from '../format/chunker';
import { escapeHtml } from '../format/html';
import { codeBlocks, markdownToBlocks, plainBlocks, type Block } from '../format/markdown';
import { renderTemplate } from '../format/template';
import { countWords, encodeUtf8, stripFrontmatter } from '../format/text';
import type TelegramBackupPlugin from '../main';
import type { SendFormat, TextStyle } from '../settings';
import type { BackupTrigger, DeliveryFormat, NoteRecord } from '../state';
import { NetworkError, TelegramApiError } from '../telegram/errors';
import { messageLink } from '../telegram/links';
import { formatBytes } from '../utils/format';
import { hashBytes, hashString } from '../utils/hash';
import { toHashtag } from '../utils/paths';
import { formatDate } from '../utils/time';
import { createEntry, entrySize, ZipArchive } from '../zip/zip-writer';
import { readFileText, resolveAttachments } from './vault-files';

export interface NoteBackupOptions {
	trigger: BackupTrigger;
	/** Overrides the "send notes as" setting. */
	format?: SendFormat;
	/** Current text of the note when the caller already has it, for example from the editor. */
	content?: string;
	/** Send even if the note has not changed since its last backup. */
	force?: boolean;
}

export interface NoteBackupResult {
	status: 'sent' | 'updated' | 'unchanged';
	format: DeliveryFormat;
	link?: string;
	attachments: number;
	warnings: string[];
}

interface DeliveryRequest {
	format: DeliveryFormat;
	chunks: string[];
	documentName: string;
	documentBytes: Uint8Array;
	caption: string;
}

interface Delivery {
	messageIds: number[];
	link?: string;
	fileId?: string;
	updated: boolean;
}

/** Converts text into message blocks in the chosen style. */
export function textToBlocks(text: string, style: TextStyle): Block[] {
	switch (style) {
		case 'formatted':
			return markdownToBlocks(text);
		case 'code':
			return codeBlocks(text);
		case 'plain':
			return plainBlocks(text);
	}
}

function attachmentSignature(file: TFile): string {
	return `${file.stat.size}:${file.stat.mtime}`;
}

function tooLarge(name: string, size: number): UserError {
	return new UserError(`“${name}” is ${formatBytes(size)}. Telegram bots can upload files of up to 50 MB.`);
}

export class NoteBackup {
	private readonly running = new Map<string, Promise<unknown>>();

	constructor(private readonly plugin: TelegramBackupPlugin) {}

	/** Backs up one file. Backups of the same file are queued so they never overlap. */
	backupFile(file: TFile, options: NoteBackupOptions): Promise<NoteBackupResult> {
		const previous = this.running.get(file.path) ?? Promise.resolve();
		const run = previous.catch(() => undefined).then(() => this.run(file, options));
		this.running.set(file.path, run);
		const cleanup = (): void => {
			if (this.running.get(file.path) === run) this.running.delete(file.path);
		};
		void run.then(cleanup, cleanup);
		return run;
	}

	/** Sends a piece of text, such as a selection, as a message. Returns a link to it when available. */
	async sendSnippet(text: string, source: TFile | null, trigger: BackupTrigger): Promise<string | undefined> {
		const { plugin } = this;
		const { settings, sender } = plugin;
		const target = plugin.requireTarget();
		const footer = settings.snippetSource && source ? `— <i>${escapeHtml(source.basename)}</i>` : undefined;
		const chunks = chunkBlocks(textToBlocks(text, settings.textStyle), { limit: MESSAGE_CHUNK_LIMIT, footer });
		if (chunks.length === 0) throw new UserError('There is no text to send.');
		if (chunks.length > MAX_TEXT_MESSAGES) {
			throw new UserError(`The text is too long: it needs ${chunks.length} messages. Back up the note as a file instead.`);
		}
		let link: string | undefined;
		let messageId: number | undefined;
		for (const chunk of chunks) {
			const message = await sender.sendHtml(chunk);
			messageId ??= message.message_id;
			link ??= messageLink(message.chat, message.message_id);
		}
		plugin.addHistory({
			kind: 'snippet',
			label: source ? `Text from ${source.basename}` : 'Text',
			trigger,
			ok: true,
			format: 'text',
			link,
			messageId,
			chatId: target.chatId,
			size: text.length,
		});
		return link;
	}

	private async run(file: TFile, options: NoteBackupOptions): Promise<NoteBackupResult> {
		const { plugin } = this;
		const { settings, app } = plugin;
		const target = plugin.requireTarget();

		let text: string | null = null;
		let bytes: Uint8Array;
		if (TEXT_FILE_EXTENSIONS.has(file.extension)) {
			text = options.content ?? (await readFileText(app, file));
			bytes = encodeUtf8(text);
		} else {
			if (file.stat.size > UPLOAD_LIMIT_BYTES) throw tooLarge(file.name, file.stat.size);
			bytes = new Uint8Array(await app.vault.readBinary(file));
		}
		if (bytes.length > UPLOAD_LIMIT_BYTES) throw tooLarge(file.name, bytes.length);

		const hash = text !== null ? hashString(text) : hashBytes(bytes);
		const stored = plugin.state.notes[file.path];
		const record = stored && stored.chatId === target.chatId ? stored : undefined;
		if (!options.force && record && record.hash === hash) {
			return { status: 'unchanged', format: record.format, link: record.link, attachments: 0, warnings: [] };
		}

		const warnings: string[] = [];
		const caption = this.renderCaption(file, text, bytes.length);
		let format: DeliveryFormat = 'file';
		let chunks: string[] = [];
		const requested = options.format ?? settings.sendFormat;
		if (text !== null && requested !== 'file' && MESSAGE_FILE_EXTENSIONS.has(file.extension)) {
			chunks = this.textChunks(text, caption);
			if (requested === 'text') {
				if (chunks.length <= MAX_TEXT_MESSAGES) format = 'text';
				else warnings.push(`“${file.basename}” would need ${chunks.length} messages, so it was sent as a file instead.`);
			} else if (chunks.length === 1) {
				format = 'text';
			}
		}

		const attachments = file.extension === 'md' && settings.attachmentMode !== 'none' ? resolveAttachments(app, file) : [];
		let documentName = file.name;
		let documentBytes = bytes;
		if (format === 'file' && settings.attachmentMode === 'zip' && attachments.length > 0) {
			const bundle = await this.bundle(file, bytes, attachments);
			if (bundle) {
				format = 'zip';
				documentName = `${file.basename}.zip`;
				documentBytes = bundle;
			} else {
				warnings.push(`The attachments of “${file.basename}” do not fit in one archive, so they were sent separately.`);
			}
		}

		const delivery = await this.deliver({ format, chunks, documentName, documentBytes, caption }, record);
		const fileId = delivery.fileId ?? (delivery.updated ? record?.fileId : undefined);
		const noteRecord: NoteRecord = {
			hash,
			at: Date.now(),
			chatId: target.chatId,
			format,
			messageIds: delivery.messageIds,
			link: delivery.link,
			fileId,
			attachments: { ...(record?.attachments ?? {}) },
		};
		plugin.state.notes[file.path] = noteRecord;
		plugin.addHistory({
			kind: 'note',
			label: file.path,
			path: file.path,
			trigger: options.trigger,
			ok: true,
			format,
			link: delivery.link,
			messageId: delivery.messageIds[0],
			chatId: target.chatId,
			fileId,
			fileName: format === 'text' ? undefined : documentName,
			size: documentBytes.length,
			updated: delivery.updated || undefined,
		});

		const sentAttachments = await this.sendAttachments(format, attachments, noteRecord, delivery.messageIds[0], warnings);
		return { status: delivery.updated ? 'updated' : 'sent', format, link: delivery.link, attachments: sentAttachments, warnings };
	}

	/** Sends new or changed attachments as replies to the note's message. */
	private async sendAttachments(
		format: DeliveryFormat,
		attachments: TFile[],
		record: NoteRecord,
		replyTo: number | undefined,
		warnings: string[],
	): Promise<number> {
		const { plugin } = this;
		const sent = (record.attachments ??= {});
		if (format === 'zip') {
			for (const attachment of attachments) sent[attachment.path] = attachmentSignature(attachment);
			plugin.requestSave();
			return attachments.length;
		}
		let count = 0;
		for (const attachment of attachments) {
			const signature = attachmentSignature(attachment);
			if (!plugin.settings.resendAttachments && sent[attachment.path] === signature) continue;
			if (attachment.stat.size > UPLOAD_LIMIT_BYTES) {
				warnings.push(`“${attachment.name}” is larger than 50 MB and was not sent.`);
				continue;
			}
			try {
				const data = new Uint8Array(await plugin.app.vault.readBinary(attachment));
				const extra = replyTo !== undefined ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {};
				await plugin.sender.sendDocument(attachment.name, data, `📎 ${escapeHtml(attachment.path)}`, extra);
				sent[attachment.path] = signature;
				count++;
				plugin.requestSave();
			} catch (error) {
				if (error instanceof NetworkError || !(error instanceof TelegramApiError)) throw error;
				warnings.push(`Could not send “${attachment.name}”: ${error.message}`);
			}
		}
		return count;
	}

	private renderCaption(file: TFile, text: string | null, size: number): string {
		const { app, settings } = this.plugin;
		const cache = app.metadataCache.getFileCache(file);
		const tags = cache ? (getAllTags(cache) ?? []) : [];
		const hashtags = [...new Set(tags.map(toHashtag).filter((tag): tag is string => tag !== null))].join(' ');
		const isNote = text !== null && MESSAGE_FILE_EXTENSIONS.has(file.extension);
		return renderTemplate(settings.captionTemplate, {
			values: {
				title: file.basename,
				name: file.name,
				path: file.path,
				folder: file.parent && !file.parent.isRoot() ? file.parent.path : '/',
				vault: app.vault.getName(),
				tags: hashtags,
				hashtags,
				words: isNote ? String(countWords(text)) : '',
				chars: isNote ? String(text.length) : '',
				size: formatBytes(size),
				extension: file.extension,
				device: Platform.isMobile ? 'mobile' : 'desktop',
			},
			dates: { now: Date.now(), created: file.stat.ctime, modified: file.stat.mtime },
			formatDate,
		});
	}

	private textChunks(text: string, header: string): string[] {
		const { settings } = this.plugin;
		const body = settings.stripFrontmatter ? stripFrontmatter(text) : text;
		const chunks = chunkBlocks(textToBlocks(body, settings.textStyle), { limit: MESSAGE_CHUNK_LIMIT, header });
		return chunks.length > 0 ? chunks : [escapeHtml('(empty note)')];
	}

	/** Packs the note and its attachments into one ZIP archive, or returns null if it would be too large. */
	private async bundle(file: TFile, bytes: Uint8Array, attachments: TFile[]): Promise<Uint8Array | null> {
		const archive = new ZipArchive();
		archive.add(createEntry(file.path, bytes, file.stat.mtime));
		for (const attachment of attachments) {
			if (attachment.stat.size > UPLOAD_LIMIT_BYTES) return null;
			const content = new Uint8Array(await this.plugin.app.vault.readBinary(attachment));
			const entry = createEntry(attachment.path, content, attachment.stat.mtime);
			if (archive.size + entrySize(entry) > UPLOAD_LIMIT_BYTES) return null;
			archive.add(entry);
		}
		return archive.toBytes();
	}

	private async deliver(request: DeliveryRequest, record: NoteRecord | undefined): Promise<Delivery> {
		const { settings, sender } = this.plugin;
		if (settings.updateMode === 'edit' && record && record.messageIds.length > 0) {
			const updated = await this.updatePrevious(request, record);
			if (updated) return updated;
		}
		if (request.format === 'text') {
			const messageIds: number[] = [];
			let link: string | undefined;
			for (const chunk of request.chunks) {
				const message = await sender.sendHtml(chunk);
				messageIds.push(message.message_id);
				link ??= messageLink(message.chat, message.message_id);
			}
			return { messageIds, link, updated: false };
		}
		const message = await sender.sendDocument(request.documentName, request.documentBytes, request.caption);
		return {
			messageIds: [message.message_id],
			link: messageLink(message.chat, message.message_id),
			fileId: message.document?.file_id,
			updated: false,
		};
	}

	/**
	 * Edits the messages of the previous backup in place. Returns null when that
	 * is not possible (the shape changed or the message is gone), after removing
	 * the outdated messages, so the caller posts a fresh copy.
	 */
	private async updatePrevious(request: DeliveryRequest, record: NoteRecord): Promise<Delivery | null> {
		const { sender } = this.plugin;
		const [firstId] = record.messageIds;
		try {
			if (request.format !== 'text' && record.format !== 'text' && record.messageIds.length === 1 && firstId !== undefined) {
				const message = await sender.editDocument(firstId, request.documentName, request.documentBytes, request.caption);
				return {
					messageIds: record.messageIds,
					link: record.link ?? (message ? messageLink(message.chat, message.message_id) : undefined),
					fileId: message?.document?.file_id,
					updated: true,
				};
			}
			if (request.format === 'text' && record.format === 'text' && record.messageIds.length === request.chunks.length) {
				for (let i = 0; i < request.chunks.length; i++) {
					await sender.editHtml(record.messageIds[i] as number, request.chunks[i] as string);
				}
				return { messageIds: record.messageIds, link: record.link, updated: true };
			}
		} catch (error) {
			if (!(error instanceof TelegramApiError)) throw error;
			// The old message was deleted or can no longer be edited; post a new one.
		}
		await sender.deleteMessages(record.messageIds);
		return null;
	}
}
