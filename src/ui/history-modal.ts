import { Modal, Setting, type App } from 'obsidian';
import type TelegramBackupPlugin from '../main';
import type { HistoryEntry } from '../state';
import { baseName } from '../utils/paths';
import { describeEntry, KIND_ICONS } from './history-format';
import { RestoreModal } from './restore-modal';

/** Lists recent backups with links to Telegram and restore buttons. */
export class HistoryModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: TelegramBackupPlugin,
		/** Show only backups of this note. */
		private readonly path?: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('telegram-backup-history-modal');
		this.setTitle(this.path ? `Backups of ${baseName(this.path)}` : 'Backup history');
		const entries = this.plugin.state.history.filter((entry) => !this.path || entry.path === this.path);
		if (entries.length === 0) {
			this.contentEl.createEl('p', { cls: 'telegram-backup-empty', text: 'No backups yet.' });
			return;
		}
		const list = this.contentEl.createDiv({ cls: 'telegram-backup-history' });
		for (const entry of entries) this.renderEntry(list, entry);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderEntry(container: HTMLElement, entry: HistoryEntry): void {
		const { plugin } = this;
		const setting = new Setting(container).setName(`${entry.ok ? KIND_ICONS[entry.kind] : '⚠️'} ${entry.label}`);
		setting.settingEl.addClass('telegram-backup-history-item');
		if (!entry.ok) setting.settingEl.addClass('is-failed');

		const desc = createFragment();
		desc.createDiv({ text: describeEntry(entry) });
		if (!entry.ok && entry.error) desc.createDiv({ cls: 'telegram-backup-error', text: entry.error });
		setting.setDesc(desc);

		const link = entry.link;
		if (link) {
			setting.addExtraButton((button) =>
				button
					.setIcon('external-link')
					.setTooltip('Open in Telegram')
					.onClick(() => {
						window.open(link);
					}),
			);
		}
		if (plugin.restore.canRestore(entry)) {
			setting.addButton((button) =>
				button.setButtonText('Restore').onClick(() => {
					this.close();
					new RestoreModal(this.app, plugin, entry).open();
				}),
			);
		} else if (entry.format === 'zip' && plugin.restore.canDownload(entry)) {
			setting.addButton((button) => button.setButtonText('Download').onClick(() => plugin.actions.download(entry)));
		}
	}
}
