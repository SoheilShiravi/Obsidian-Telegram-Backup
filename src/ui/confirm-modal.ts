import { Modal, Setting, type App } from 'obsidian';

export interface ConfirmOptions {
	title: string;
	message: string;
	confirmText: string;
	destructive?: boolean;
	onConfirm: () => void;
}

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly options: ConfirmOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, options } = this;
		this.setTitle(options.title);
		contentEl.createEl('p', { text: options.message });
		new Setting(contentEl)
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((button) => {
				button.setButtonText(options.confirmText).onClick(() => {
					this.close();
					options.onConfirm();
				});
				if (options.destructive) button.setDestructive().setCta();
				else button.setCta();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
