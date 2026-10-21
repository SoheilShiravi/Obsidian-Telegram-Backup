import { setIcon, setTooltip } from 'obsidian';
import type TelegramBackupPlugin from '../main';
import { fromNow } from '../utils/time';
import { HistoryModal } from './history-modal';

/** Status bar item that shows when the last backup happened. Select it to open the history. */
export class StatusBarItem {
	private readonly textEl: HTMLElement;
	private readonly tasks = new Map<number, string>();
	private nextTask = 0;
	private failure: string | null = null;

	constructor(
		private readonly plugin: TelegramBackupPlugin,
		private readonly el: HTMLElement,
	) {
		el.addClass('telegram-backup-status');
		const iconEl = el.createSpan({ cls: 'telegram-backup-status-icon' });
		setIcon(iconEl, 'send');
		this.textEl = el.createSpan({ cls: 'telegram-backup-status-text' });
		plugin.registerDomEvent(el, 'click', () => new HistoryModal(plugin.app, plugin).open());
		this.refresh();
	}

	/** Marks the start of a task. Call the returned function when the task ends. */
	begin(message: string): () => void {
		const id = this.nextTask++;
		this.tasks.set(id, message);
		this.failure = null;
		this.refresh();
		return () => {
			this.tasks.delete(id);
			this.refresh();
		};
	}

	fail(message: string): void {
		this.failure = message;
		this.refresh();
	}

	refresh(): void {
		const { el, textEl } = this;
		const running = [...this.tasks.values()];
		el.toggleClass('is-busy', running.length > 0);
		el.toggleClass('is-error', running.length === 0 && this.failure !== null);
		if (running.length > 0) {
			textEl.setText(running.length > 1 ? `Sending (${running.length})…` : 'Sending…');
			setTooltip(el, running.join('\n'));
			return;
		}
		if (this.failure !== null) {
			textEl.setText('Backup failed');
			setTooltip(el, `${this.failure}\nSelect to open the backup history.`);
			return;
		}
		const last = this.plugin.state.history.find((entry) => entry.ok && entry.kind !== 'test');
		textEl.setText(last ? `Backed up ${fromNow(last.at)}` : 'No backups yet');
		setTooltip(el, 'Telegram Backup: select to open the backup history.');
	}

	destroy(): void {
		this.el.remove();
	}
}
