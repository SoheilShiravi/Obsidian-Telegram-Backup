import { Notice } from 'obsidian';
import type { ProgressReporter } from '../backup/archives';

/** A notice that stays visible while an archive backup runs, with a button to cancel it. */
export class ProgressNotice implements ProgressReporter {
	private readonly notice: Notice;
	private readonly textEl: HTMLElement;

	constructor(message: string, onCancel?: () => void) {
		const fragment = createFragment();
		const wrapper = fragment.createDiv({ cls: 'telegram-backup-progress' });
		this.textEl = wrapper.createDiv({ cls: 'telegram-backup-progress-text', text: message });
		if (onCancel) {
			const button = wrapper.createEl('button', { cls: 'telegram-backup-progress-cancel', text: 'Cancel' });
			button.addEventListener('click', (event) => {
				// Keep the notice open: clicking a notice normally dismisses it.
				event.stopPropagation();
				button.disabled = true;
				button.setText('Cancelling…');
				onCancel();
			});
		}
		this.notice = new Notice(fragment, 0);
	}

	update(message: string): void {
		this.textEl.setText(message);
	}

	hide(): void {
		this.notice.hide();
	}
}
