import { TFile, TFolder } from 'obsidian';
import type TelegramBackupPlugin from './main';
import { HistoryModal } from './ui/history-modal';
import { FolderPickerModal } from './ui/folder-picker-modal';
import { VersionPickerModal } from './ui/restore-modal';

/** Registers the command palette commands. None of them has a default hotkey. */
export function registerCommands(plugin: TelegramBackupPlugin): void {
	const { app } = plugin;
	const activeFile = (): TFile | null => app.workspace.getActiveFile();

	plugin.addCommand({
		id: 'back-up-current-note',
		name: 'Back up current note',
		icon: 'send',
		checkCallback: (checking) => {
			const file = activeFile();
			if (!file) return false;
			if (!checking) void plugin.actions.backupFile(file, { trigger: 'manual', force: true });
			return true;
		},
	});

	plugin.addCommand({
		id: 'back-up-current-note-as-file',
		name: 'Back up current note as a file',
		icon: 'file-up',
		checkCallback: (checking) => {
			const file = activeFile();
			if (!file) return false;
			if (!checking) void plugin.actions.backupFile(file, { trigger: 'manual', force: true, format: 'file' });
			return true;
		},
	});

	plugin.addCommand({
		id: 'back-up-current-note-as-text',
		name: 'Back up current note as text messages',
		icon: 'message-square-text',
		checkCallback: (checking) => {
			const file = activeFile();
			if (!file || file.extension !== 'md') return false;
			if (!checking) void plugin.actions.backupFile(file, { trigger: 'manual', force: true, format: 'text' });
			return true;
		},
	});

	plugin.addCommand({
		id: 'send-selection',
		name: 'Send selected text',
		icon: 'text-select',
		editorCheckCallback: (checking, editor, context) => {
			const text = editor.getSelection();
			if (!text.trim()) return false;
			if (!checking) void plugin.actions.sendSnippet(text, context.file, 'manual');
			return true;
		},
	});

	plugin.addCommand({
		id: 'back-up-folder',
		name: 'Back up a folder as a zip archive',
		icon: 'folder-up',
		callback: () => {
			new FolderPickerModal(app, (folder) => void plugin.actions.backupArchive({ kind: 'folder', folder }, 'manual')).open();
		},
	});

	plugin.addCommand({
		id: 'back-up-vault',
		name: 'Back up the entire vault as zip archives',
		icon: 'archive',
		callback: () => void plugin.actions.backupArchive({ kind: 'vault' }, 'manual'),
	});

	plugin.addCommand({
		id: 'back-up-changes',
		name: 'Back up files changed since the last vault backup',
		icon: 'history',
		callback: () => void plugin.actions.backupArchive({ kind: 'changes' }, 'manual'),
	});

	plugin.addCommand({
		id: 'cancel-archive-backup',
		name: 'Cancel the running archive backup',
		icon: 'circle-stop',
		checkCallback: (checking) => {
			if (!plugin.archives.isRunning) return false;
			if (!checking) plugin.archives.cancel();
			return true;
		},
	});

	plugin.addCommand({
		id: 'restore-current-note',
		name: 'Restore current note from a backup',
		icon: 'rotate-ccw',
		checkCallback: (checking) => {
			const file = activeFile();
			if (!file) return false;
			const versions = plugin.restore.versionsOf(file.path);
			if (versions.length === 0) return false;
			if (!checking) new VersionPickerModal(app, plugin, versions).open();
			return true;
		},
	});

	plugin.addCommand({
		id: 'show-history',
		name: 'Show backup history',
		icon: 'list',
		callback: () => new HistoryModal(app, plugin).open(),
	});

	plugin.addCommand({
		id: 'show-note-history',
		name: 'Show backups of current note',
		icon: 'list',
		checkCallback: (checking) => {
			const file = activeFile();
			if (!file) return false;
			if (!checking) new HistoryModal(app, plugin, file.path).open();
			return true;
		},
	});

	plugin.addCommand({
		id: 'send-test-message',
		name: 'Send a test message',
		icon: 'message-circle',
		callback: () => void plugin.actions.sendTestMessage(),
	});
}

/** Adds backup entries to the file, folder, multi-selection and editor context menus. */
export function registerMenus(plugin: TelegramBackupPlugin): void {
	const { workspace } = plugin.app;

	plugin.registerEvent(
		workspace.on('file-menu', (menu, file) => {
			if (file instanceof TFile) {
				menu.addItem((item) =>
					item
						.setTitle('Back up to Telegram')
						.setIcon('send')
						.setSection('action')
						.onClick(() => void plugin.actions.backupFile(file, { trigger: 'manual', force: true })),
				);
			} else if (file instanceof TFolder) {
				menu.addItem((item) =>
					item
						.setTitle('Back up folder to Telegram')
						.setIcon('folder-up')
						.setSection('action')
						.onClick(() => void plugin.actions.backupArchive({ kind: 'folder', folder: file }, 'manual')),
				);
			}
		}),
	);

	plugin.registerEvent(
		workspace.on('files-menu', (menu, files) => {
			if (files.length === 0) return;
			menu.addItem((item) =>
				item
					.setTitle(`Back up ${files.length} items to Telegram`)
					.setIcon('send')
					.setSection('action')
					.onClick(() => void plugin.actions.backupArchive({ kind: 'items', items: files }, 'manual')),
			);
		}),
	);

	plugin.registerEvent(
		workspace.on('editor-menu', (menu, editor, info) => {
			const text = editor.getSelection();
			if (text.trim()) {
				menu.addItem((item) =>
					item
						.setTitle('Send selection to Telegram')
						.setIcon('send')
						.setSection('selection')
						.onClick(() => void plugin.actions.sendSnippet(text, info.file, 'manual')),
				);
			}
			const file = info.file;
			if (file) {
				menu.addItem((item) =>
					item
						.setTitle('Back up note to Telegram')
						.setIcon('send')
						.setSection('action')
						.onClick(() => void plugin.actions.backupFile(file, { trigger: 'manual', force: true })),
				);
			}
		}),
	);
}
