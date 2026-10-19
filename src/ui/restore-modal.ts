import { Modal, moment, Setting, SuggestModal, type App } from 'obsidian';
import type { RestoreMode } from '../backup/restore';
import type TelegramBackupPlugin from '../main';
import type { HistoryEntry } from '../state';
import { describeEntry } from './history-format';

/** Lets the user pick which backed-up version of a note to restore. */
export class VersionPickerModal extends SuggestModal<HistoryEntry> {
	constructor(
		app: App,
		private readonly plugin: TelegramBackupPlugin,
		private readonly versions: HistoryEntry[],
	) {
		super(app);
		this.setPlaceholder('Choose the version to restore');
	}

	getSuggestions(query: string): HistoryEntry[] {
		const q = query.trim().toLowerCase();
		return q ? this.versions.filter((entry) => describeEntry(entry).toLowerCase().includes(q)) : this.versions;
	}

	renderSuggestion(entry: HistoryEntry, el: HTMLElement): void {
		el.addClass('telegram-backup-suggestion');
		el.createDiv({ text: moment(entry.at).format('dddd, D MMMM YYYY, HH:mm') });
		el.createDiv({ cls: 'telegram-backup-suggestion-note', text: describeEntry(entry) });
	}

	onChooseSuggestion(entry: HistoryEntry): void {
		new RestoreModal(this.app, this.plugin, entry).open();
	}
}

/** Asks whether a backup should replace the note or be saved as a copy. */
export class RestoreModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: TelegramBackupPlugin,
		private readonly entry: HistoryEntry,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, entry } = this;
		const path = entry.path ?? '';
		const exists = this.app.vault.getFileByPath(path) !== null;
		this.setTitle('Restore from Telegram');
		contentEl.createEl('p', { text: `Restore “${path}” from the backup made on ${moment(entry.at).format('YYYY-MM-DD HH:mm')}?` });
		if (exists) {
			contentEl.createEl('p', {
				cls: 'telegram-backup-muted',
				text: 'Saving a copy keeps the current note unchanged. Replacing overwrites the current content of the note.',
			});
		}
		const buttons = new Setting(contentEl);
		buttons.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
		if (exists) {
			buttons.addButton((button) => button.setButtonText('Replace note').setDestructive().onClick(() => this.run('replace')));
			buttons.addButton((button) => button.setButtonText('Save as copy').setCta().onClick(() => this.run('copy')));
		} else {
			buttons.addButton((button) => button.setButtonText('Restore').setCta().onClick(() => this.run('copy')));
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private run(mode: RestoreMode): void {
		this.close();
		void this.plugin.actions.restore(this.entry, mode);
	}
}
