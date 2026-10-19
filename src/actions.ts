import { Notice, type TFile } from 'obsidian';
import type { ArchiveRequest } from './backup/archives';
import { sendTestMessage } from './backup/connection';
import type { NoteBackupOptions, NoteBackupResult } from './backup/notes';
import type { RestoreMode } from './backup/restore';
import { CancelledError, ConfigError, errorMessage, UserError } from './errors';
import type TelegramBackupPlugin from './main';
import type { BackupTrigger, HistoryEntry, NewHistoryEntry } from './state';
import { NetworkError, TelegramApiError } from './telegram/errors';
import { ProgressNotice } from './ui/progress-notice';
import { formatBytes, plural } from './utils/format';

const BACKGROUND_TRIGGERS: readonly BackupTrigger[] = ['auto', 'scheduled'];

type FailedEntry = Omit<NewHistoryEntry, 'trigger' | 'ok' | 'error'>;

export function describeError(error: unknown): string {
	return error instanceof Error ? error.message : errorMessage(error);
}

function successMessage(name: string, result: NoteBackupResult): string {
	if (result.status === 'updated') return `Updated the backup of “${name}” in Telegram.`;
	const how = result.format === 'text' ? ' as text' : result.format === 'zip' ? ' as a zip archive' : '';
	const extra = result.attachments > 0 ? ` with ${plural(result.attachments, 'attachment')}` : '';
	return `Backed up “${name}” to Telegram${how}${extra}.`;
}

/**
 * User-facing operations: runs a backup service, then reports the outcome
 * with notices, the status bar and the backup history.
 */
export class Actions {
	constructor(private readonly plugin: TelegramBackupPlugin) {}

	/** Backs up a file. Returns false when the backup failed. */
	async backupFile(file: TFile, options: NoteBackupOptions): Promise<boolean> {
		const { plugin } = this;
		const background = BACKGROUND_TRIGGERS.includes(options.trigger);
		const done = plugin.status?.begin(`Backing up ${file.basename}…`);
		try {
			const result = await plugin.notes.backupFile(file, options);
			plugin.removePending(file.path);
			if (!background) {
				for (const warning of result.warnings) new Notice(warning, 8000);
				if (result.status === 'unchanged') new Notice(`“${file.basename}” has not changed since its last backup.`);
				else if (plugin.settings.showSuccessNotices) new Notice(successMessage(file.basename, result));
			}
			return true;
		} catch (error) {
			if (options.trigger === 'auto' && !(error instanceof ConfigError)) plugin.addPending(file.path);
			this.report(error, `Could not back up “${file.basename}”`, options.trigger, { kind: 'note', label: file.path, path: file.path });
			return false;
		} finally {
			done?.();
		}
	}

	/** Sends a selection or a line of text. Returns false when sending failed. */
	async sendSnippet(text: string, source: TFile | null, trigger: BackupTrigger): Promise<boolean> {
		const { plugin } = this;
		const done = plugin.status?.begin('Sending text…');
		try {
			await plugin.notes.sendSnippet(text, source, trigger);
			if (plugin.settings.showSuccessNotices) new Notice('Sent to Telegram.');
			return true;
		} catch (error) {
			this.report(error, 'Could not send the text', trigger, { kind: 'snippet', label: source ? `Text from ${source.basename}` : 'Text' });
			return false;
		} finally {
			done?.();
		}
	}

	/** Backs up the vault, a folder or a selection as zip archives. Returns false when it failed. */
	async backupArchive(request: ArchiveRequest, trigger: BackupTrigger): Promise<boolean> {
		const { plugin } = this;
		if (plugin.archives.isRunning) {
			if (trigger !== 'scheduled') new Notice('An archive backup is already running.');
			return false;
		}
		const title = plugin.archives.describeRequest(request);
		const background = BACKGROUND_TRIGGERS.includes(trigger);
		const progress = background ? undefined : new ProgressNotice(`Backing up ${title}…`, () => plugin.archives.cancel());
		const done = plugin.status?.begin(`Backing up ${title}…`);
		try {
			const result = await plugin.archives.run(request, trigger, progress);
			if (!background) {
				if (result.status === 'empty') {
					new Notice(request.kind === 'changes' ? 'Nothing has changed since the last backup.' : 'There are no files to back up.');
				} else if (result.summary) {
					const { files, parts, archiveBytes, skipped } = result.summary;
					const skippedText = skipped.length > 0 ? ` ${plural(skipped.length, 'file')} skipped.` : '';
					new Notice(
						`Backed up ${title}: ${plural(files, 'file')} in ${plural(parts, 'archive')} (${formatBytes(archiveBytes)}).${skippedText}`,
						8000,
					);
				}
			}
			return true;
		} catch (error) {
			this.report(error, `Could not back up ${title}`, trigger, { kind: 'archive', archive: request.kind, label: title });
			return false;
		} finally {
			progress?.hide();
			done?.();
		}
	}

	async restore(entry: HistoryEntry, mode: RestoreMode): Promise<void> {
		const { plugin } = this;
		const done = plugin.status?.begin('Downloading backup…');
		try {
			const file = await plugin.restore.restoreNote(entry, mode);
			if (mode === 'replace') {
				new Notice(`Restored “${file.basename}” from Telegram.`);
			} else {
				new Notice(`Saved the backup as “${file.path}”.`);
				await plugin.app.workspace.getLeaf(true).openFile(file);
			}
		} catch (error) {
			this.report(error, 'Could not restore the backup', 'manual');
		} finally {
			done?.();
		}
	}

	async download(entry: HistoryEntry): Promise<void> {
		const { plugin } = this;
		const done = plugin.status?.begin('Downloading backup…');
		try {
			const file = await plugin.restore.downloadToVault(entry);
			new Notice(`Saved “${file.path}”.`);
		} catch (error) {
			this.report(error, 'Could not download the backup', 'manual');
		} finally {
			done?.();
		}
	}

	async sendTestMessage(): Promise<boolean> {
		const { plugin } = this;
		const done = plugin.status?.begin('Sending test message…');
		try {
			await sendTestMessage(plugin);
			new Notice('Test message sent. Check your Telegram chat.');
			return true;
		} catch (error) {
			this.report(error, 'Could not send the test message', 'manual');
			return false;
		} finally {
			done?.();
		}
	}

	/** Shows an error, records it in the history and marks the status bar. */
	report(error: unknown, title: string, trigger: BackupTrigger, failed?: FailedEntry): void {
		const { plugin } = this;
		if (error instanceof CancelledError) {
			new Notice('Backup cancelled.');
			return;
		}
		const message = describeError(error);
		if (failed && !(error instanceof ConfigError)) plugin.addHistory({ ...failed, trigger, ok: false, error: message });
		plugin.status?.fail(message);
		const background = BACKGROUND_TRIGGERS.includes(trigger);
		if (!background || plugin.shouldShowBackgroundError()) new Notice(`${title}. ${message}`, 10000);
		const expected = error instanceof UserError || error instanceof TelegramApiError || error instanceof NetworkError;
		if (!expected) console.error('Telegram Backup:', error);
	}
}
