import { normalizePath, type CliData, type CliFlags, type CliHandler } from 'obsidian';
import { describeError } from './actions';
import type TelegramBackupPlugin from './main';
import { formatBytes, plural } from './utils/format';
import { formatDate } from './utils/time';

/**
 * Handlers for the Obsidian command line interface, so backups can be started
 * from a terminal or an operating system scheduler, for example:
 *
 *   obsidian telegram-backup:vault
 *   obsidian telegram-backup:note path="Inbox/Idea.md"
 *   obsidian telegram-backup:send text="Hello from the terminal"
 */
export function registerCli(plugin: TelegramBackupPlugin): void {
	// The command line interface is only available in the desktop app.
	if (typeof plugin.registerCliHandler !== 'function') return;
	const register = (command: string, description: string, flags: CliFlags | null, handler: CliHandler): void => {
		try {
			plugin.registerCliHandler(command, description, flags, handler);
		} catch (error) {
			console.warn(`Telegram Backup: could not register the "${command}" command line handler.`, error);
		}
	};

	const guarded =
		(handler: (params: CliData) => Promise<string>): CliHandler =>
		async (params) => {
			try {
				return await handler(params);
			} catch (error) {
				return `Error: ${describeError(error)}`;
			}
		};

	register('telegram-backup', 'Show the Telegram Backup status', null, () => status(plugin));

	register(
		'telegram-backup:note',
		'Back up a note to Telegram',
		{ path: { value: '<path>', description: 'Vault path of the note, for example Inbox/Idea.md', required: true } },
		guarded(async (params) => {
			const path = normalizePath(params.path ?? '');
			const file = plugin.app.vault.getFileByPath(path);
			if (!file) return `Error: no file at "${path}".`;
			const result = await plugin.notes.backupFile(file, { trigger: 'cli', force: true });
			return `Backed up ${file.path}${result.link ? ` → ${result.link}` : ''}`;
		}),
	);

	register(
		'telegram-backup:vault',
		'Back up the whole vault as zip archives',
		null,
		guarded(async () => {
			const result = await plugin.archives.run({ kind: 'vault' }, 'cli');
			if (result.status === 'empty' || !result.summary) return 'There are no files to back up.';
			const { files, parts, archiveBytes } = result.summary;
			return `Backed up ${plural(files, 'file')} in ${plural(parts, 'archive')} (${formatBytes(archiveBytes)}).`;
		}),
	);

	register(
		'telegram-backup:changes',
		'Back up files changed since the last vault backup',
		null,
		guarded(async () => {
			const result = await plugin.archives.run({ kind: 'changes' }, 'cli');
			if (result.status === 'empty' || !result.summary) return 'Nothing has changed since the last backup.';
			return `Backed up ${plural(result.summary.files, 'changed file')} (${formatBytes(result.summary.archiveBytes)}).`;
		}),
	);

	register(
		'telegram-backup:send',
		'Send a text message to the backup chat',
		{ text: { value: '<text>', description: 'The message to send', required: true } },
		guarded(async (params) => {
			const text = params.text ?? '';
			if (!text.trim()) return 'Error: the text is empty.';
			const link = await plugin.notes.sendSnippet(text, null, 'cli');
			return link ? `Sent → ${link}` : 'Sent.';
		}),
	);
}

function status(plugin: TelegramBackupPlugin): string {
	const configured = plugin.isConfigured();
	const last = plugin.state.history.find((entry) => entry.ok && entry.kind !== 'test');
	const lines = [
		`Configured: ${configured ? 'yes' : 'no (set the bot token and chat ID in the plugin settings)'}`,
		`Last backup: ${last ? `${formatDate(last.at, 'YYYY-MM-DD HH:mm')} (${last.label})` : 'never'}`,
		`Scheduled vault backup: ${plugin.settings.scheduledBackup ? `every ${plugin.settings.scheduledInterval} h` : 'off'}`,
		`Automatic note backups: ${plugin.settings.autoBackupOnChange ? 'on' : 'off'}`,
	];
	return lines.join('\n');
}
