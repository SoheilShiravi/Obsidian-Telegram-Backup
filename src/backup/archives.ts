import { moment, TFile, TFolder, type TAbstractFile } from 'obsidian';
import { MEGABYTE, NOTE_EXTENSIONS } from '../constants';
import { UserError } from '../errors';
import { escapeHtml } from '../format/html';
import type TelegramBackupPlugin from '../main';
import type { BackupTrigger } from '../state';
import { messageLink } from '../telegram/links';
import { formatBytes, plural } from '../utils/format';
import { sanitizeFileName } from '../utils/paths';
import { buildArchives, type ArchivePart, type ArchiveSource, type ArchiveSummary } from '../zip/archive-builder';
import { configFolderSources, createExclusionFilter, fileSource, filesInFolder } from './vault-files';

export type ArchiveRequest =
	| { kind: 'vault' }
	| { kind: 'changes' }
	| { kind: 'folder'; folder: TFolder }
	| { kind: 'items'; items: TAbstractFile[] };

export interface ArchiveResult {
	status: 'sent' | 'empty';
	summary?: ArchiveSummary;
	link?: string;
}

/** Reports progress of a long-running archive backup to the user interface. */
export interface ProgressReporter {
	update(message: string): void;
}

interface FirstPart {
	link?: string;
	messageId: number;
	fileId?: string;
	fileName: string;
}

interface ArchiveLabel {
	/** Short description for history and notices. */
	title: string;
	/** First caption line (HTML). */
	headline: string;
	hashtag: string;
	baseName: string;
}

const MAX_LISTED_SKIPPED = 15;

export class ArchiveBackup {
	private job: { cancelled: boolean } | null = null;

	constructor(private readonly plugin: TelegramBackupPlugin) {}

	get isRunning(): boolean {
		return this.job !== null;
	}

	cancel(): void {
		if (this.job) this.job.cancelled = true;
	}

	/** True when a file that would be part of a vault archive changed after `since`. */
	hasChangesSince(since: number): boolean {
		const exclude = createExclusionFilter(this.plugin.app, this.plugin.settings);
		return this.plugin.app.vault.getFiles().some((file) => file.stat.mtime > since && this.inScope(file) && !exclude(file));
	}

	async run(request: ArchiveRequest, trigger: BackupTrigger, progress?: ProgressReporter): Promise<ArchiveResult> {
		const { plugin } = this;
		const target = plugin.requireTarget();
		if (this.job) throw new UserError('An archive backup is already running.');
		const job = { cancelled: false };
		this.job = job;
		const startedAt = Date.now();
		const baseline = plugin.state.changesBaseline;
		try {
			progress?.update('Collecting files…');
			const sources = await this.collect(request, baseline);
			if (sources.length === 0) {
				if (request.kind === 'vault' || request.kind === 'changes') {
					plugin.state.changesBaseline = startedAt;
					plugin.requestSave();
				}
				return { status: 'empty' };
			}

			const label = this.describe(request, baseline);
			const uploaded: { first?: FirstPart } = {};
			const summary = await buildArchives(sources, {
				partLimit: plugin.settings.archivePartSizeMb * MEGABYTE,
				isCancelled: () => job.cancelled,
				onProgress: (done, total, part) => {
					progress?.update(`Compressing ${done.toLocaleString('en-US')} of ${plural(total, 'file')}${part > 1 ? ` (archive ${part})` : ''}…`);
				},
				onPart: async (part) => {
					const multiPart = !(part.index === 1 && part.isLast);
					const fileName = multiPart ? `${label.baseName}-part${part.index}.zip` : `${label.baseName}.zip`;
					progress?.update(`Uploading ${fileName} (${formatBytes(part.bytes.length)})…`);
					const message = await plugin.sender.sendDocument(fileName, part.bytes, this.caption(label, part, multiPart));
					if (part.index === 1) {
						uploaded.first = {
							link: messageLink(message.chat, message.message_id),
							messageId: message.message_id,
							fileId: message.document?.file_id,
							fileName,
						};
					}
				},
			});
			const { first } = uploaded;

			if (summary.parts > 1 || summary.skipped.length > 0) {
				await plugin.sender.sendHtml(this.summaryMessage(label, summary));
			}
			if (request.kind === 'vault' || request.kind === 'changes') plugin.state.changesBaseline = startedAt;
			plugin.addHistory({
				kind: 'archive',
				archive: request.kind,
				label: label.title,
				trigger,
				ok: true,
				format: 'zip',
				link: first?.link,
				messageId: first?.messageId,
				chatId: target.chatId,
				fileId: summary.parts === 1 ? first?.fileId : undefined,
				fileName: summary.parts === 1 ? first?.fileName : undefined,
				size: summary.archiveBytes,
				parts: summary.parts,
				files: summary.files,
			});
			return { status: 'sent', summary, link: first?.link };
		} finally {
			this.job = null;
		}
	}

	/** Describes an archive request in words, for history entries and error messages. */
	describeRequest(request: ArchiveRequest): string {
		return this.describe(request, this.plugin.state.changesBaseline).title;
	}

	private inScope(file: TFile): boolean {
		return this.plugin.settings.archiveScope === 'all' || NOTE_EXTENSIONS.has(file.extension);
	}

	private async collect(request: ArchiveRequest, baseline: number): Promise<ArchiveSource[]> {
		const { app, settings } = this.plugin;
		const exclude = createExclusionFilter(app, settings);
		let files: TFile[];
		switch (request.kind) {
			case 'vault':
				files = app.vault.getFiles().filter((file) => this.inScope(file));
				break;
			case 'changes':
				files = app.vault.getFiles().filter((file) => file.stat.mtime > baseline && this.inScope(file));
				break;
			case 'folder':
				files = filesInFolder(request.folder);
				break;
			case 'items': {
				const unique = new Map<string, TFile>();
				for (const item of request.items) {
					const found = item instanceof TFile ? [item] : item instanceof TFolder ? filesInFolder(item) : [];
					for (const file of found) unique.set(file.path, file);
				}
				files = [...unique.values()];
				break;
			}
		}
		const sources = files
			.filter((file) => !exclude(file))
			.sort((a, b) => a.path.localeCompare(b.path))
			.map((file) => fileSource(app, file));
		if (request.kind === 'vault' && settings.includeConfigFolder) {
			sources.push(...(await configFolderSources(app)));
		}
		return sources;
	}

	private describe(request: ArchiveRequest, baseline: number): ArchiveLabel {
		const vaultName = this.plugin.app.vault.getName();
		const vaultSlug = sanitizeFileName(vaultName);
		const stamp = moment().format('YYYY-MM-DD_HHmm');
		switch (request.kind) {
			case 'vault':
				return {
					title: `Vault “${vaultName}”`,
					headline: `🗄 <b>Vault backup</b> · ${escapeHtml(vaultName)}`,
					hashtag: '#vault_backup',
					baseName: `${vaultSlug}-${stamp}`,
				};
			case 'changes': {
				const since = baseline > 0 ? moment(baseline).format('YYYY-MM-DD HH:mm') : '';
				return {
					title: since ? `Changes since ${since}` : 'Changes (first backup, all files)',
					headline: since
						? `🔄 <b>Changed files</b> since ${escapeHtml(since)}`
						: '🔄 <b>Changed files</b> · first backup, all files included',
					hashtag: '#changes_backup',
					baseName: `${vaultSlug}-changes-${stamp}`,
				};
			}
			case 'folder': {
				const path = request.folder.isRoot() ? '/' : request.folder.path;
				return {
					title: `Folder “${path}”`,
					headline: `📂 <b>Folder backup</b> · <code>${escapeHtml(path)}</code>`,
					hashtag: '#folder_backup',
					baseName: `${vaultSlug}-${sanitizeFileName(request.folder.isRoot() ? 'root' : request.folder.name)}-${stamp}`,
				};
			}
			case 'items':
				return {
					title: plural(request.items.length, 'selected item'),
					headline: `🗂 <b>Selected files</b> · ${escapeHtml(vaultName)}`,
					hashtag: '#files_backup',
					baseName: `${vaultSlug}-selection-${stamp}`,
				};
		}
	}

	private caption(label: ArchiveLabel, part: ArchivePart, multiPart: boolean): string {
		const details = `${plural(part.fileCount, 'file')} · ${formatBytes(part.bytes.length)}`;
		return [
			label.headline,
			`📦 ${multiPart ? `Part ${part.index} · ` : ''}${details}`,
			`🕒 ${escapeHtml(moment().format('YYYY-MM-DD HH:mm'))}`,
			label.hashtag,
		].join('\n');
	}

	private summaryMessage(label: ArchiveLabel, summary: ArchiveSummary): string {
		const lines = [
			`✅ <b>Backup complete</b> · ${escapeHtml(label.title)}`,
			`${plural(summary.parts, 'archive')} · ${plural(summary.files, 'file')} · ${formatBytes(summary.originalBytes)} → ${formatBytes(summary.archiveBytes)}`,
		];
		if (summary.skipped.length > 0) {
			lines.push('', `⚠️ <b>${plural(summary.skipped.length, 'file')} skipped</b> (too large or unreadable):`);
			for (const file of summary.skipped.slice(0, MAX_LISTED_SKIPPED)) {
				lines.push(`• <code>${escapeHtml(file.path)}</code> (${formatBytes(file.size)})`);
			}
			if (summary.skipped.length > MAX_LISTED_SKIPPED) lines.push(`…and ${summary.skipped.length - MAX_LISTED_SKIPPED} more`);
		}
		lines.push(label.hashtag);
		return lines.join('\n');
	}
}
