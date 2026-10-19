import { moment, normalizePath, type TFile } from 'obsidian';
import { DOWNLOAD_FOLDER, DOWNLOAD_LIMIT_BYTES, TEXT_FILE_EXTENSIONS } from '../constants';
import { UserError } from '../errors';
import { decodeUtf8 } from '../format/text';
import type TelegramBackupPlugin from '../main';
import type { HistoryEntry } from '../state';
import { baseName, extensionOf, parentFolder, sanitizeFileName } from '../utils/paths';

export type RestoreMode = 'replace' | 'copy';

function joinPath(folder: string, name: string): string {
	return normalizePath(folder ? `${folder}/${name}` : name);
}

/** Downloads earlier backups from Telegram back into the vault. */
export class RestoreService {
	constructor(private readonly plugin: TelegramBackupPlugin) {}

	/** Note backups that were sent as a file can be written back into the vault. */
	canRestore(entry: HistoryEntry): boolean {
		return (
			entry.ok &&
			entry.kind === 'note' &&
			entry.format === 'file' &&
			!!entry.fileId &&
			!!entry.path &&
			(entry.size ?? 0) <= DOWNLOAD_LIMIT_BYTES
		);
	}

	/** Archives (including notes bundled with their attachments) can be downloaded when they are small enough for the Bot API. */
	canDownload(entry: HistoryEntry): boolean {
		return entry.ok && !!entry.fileId && !!entry.fileName && (entry.size ?? 0) <= DOWNLOAD_LIMIT_BYTES;
	}

	/** Restorable versions of a note, newest first. */
	versionsOf(path: string): HistoryEntry[] {
		return this.plugin.state.history.filter((entry) => entry.path === path && this.canRestore(entry));
	}

	/** Writes a backed-up version of a note into the vault, replacing the note or as a copy next to it. */
	async restoreNote(entry: HistoryEntry, mode: RestoreMode): Promise<TFile> {
		if (!entry.path) throw new UserError('This backup is not linked to a note.');
		const { vault } = this.plugin.app;
		const data = await this.download(entry);
		const path = normalizePath(entry.path);
		const isText = TEXT_FILE_EXTENSIONS.has(extensionOf(path));
		const existing = vault.getFileByPath(path);
		if (existing && mode === 'replace') {
			if (isText) {
				const text = decodeUtf8(data);
				await vault.process(existing, () => text);
			} else {
				await vault.modifyBinary(existing, data);
			}
			return existing;
		}
		const target = existing ? this.availablePath(this.copyPath(path, entry.at)) : path;
		await this.ensureFolder(parentFolder(target));
		return isText ? vault.create(target, decodeUtf8(data)) : vault.createBinary(target, data);
	}

	/** Saves a backup file, such as an archive, into the downloads folder of the vault. */
	async downloadToVault(entry: HistoryEntry): Promise<TFile> {
		const data = await this.download(entry);
		await this.ensureFolder(DOWNLOAD_FOLDER);
		const name = sanitizeFileName(entry.fileName ?? `backup-${entry.id}.zip`);
		return this.plugin.app.vault.createBinary(this.availablePath(joinPath(DOWNLOAD_FOLDER, name)), data);
	}

	private async download(entry: HistoryEntry): Promise<ArrayBuffer> {
		if (!entry.fileId) throw new UserError('This backup has no file that can be downloaded.');
		const { client } = this.plugin;
		const file = await client.getFile(entry.fileId);
		if (!file.file_path) {
			throw new UserError('Telegram did not provide a download link. Bots can only download files of up to 20 MB.');
		}
		return client.downloadFile(file.file_path);
	}

	private copyPath(path: string, at: number): string {
		const ext = extensionOf(path);
		const name = `${baseName(path)} (backup ${moment(at).format('YYYY-MM-DD HHmm')})${ext ? `.${ext}` : ''}`;
		return joinPath(parentFolder(path), name);
	}

	private availablePath(path: string): string {
		const { vault } = this.plugin.app;
		if (!vault.getAbstractFileByPath(path)) return path;
		const folder = parentFolder(path);
		const ext = extensionOf(path);
		const base = baseName(path);
		for (let n = 2; ; n++) {
			const candidate = joinPath(folder, `${base} ${n}${ext ? `.${ext}` : ''}`);
			if (!vault.getAbstractFileByPath(candidate)) return candidate;
		}
	}

	private async ensureFolder(folder: string): Promise<void> {
		const { vault } = this.plugin.app;
		let current = '';
		for (const segment of folder.split('/').filter(Boolean)) {
			current = current ? `${current}/${segment}` : segment;
			if (!vault.getAbstractFileByPath(current)) await vault.createFolder(current);
		}
	}
}
