import { FuzzySuggestModal, type App, type TFolder } from 'obsidian';

/** Lets the user pick a folder to back up. */
export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
	constructor(
		app: App,
		private readonly onPick: (folder: TFolder) => void,
	) {
		super(app);
		this.setPlaceholder('Choose a folder to back up');
	}

	getItems(): TFolder[] {
		return this.app.vault.getAllFolders(true);
	}

	getItemText(folder: TFolder): string {
		return folder.isRoot() ? '/' : folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onPick(folder);
	}
}
