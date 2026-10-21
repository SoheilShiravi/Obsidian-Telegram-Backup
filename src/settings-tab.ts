import { Notice, PluginSettingTab, type App, type ButtonComponent, type Setting, type SettingDefinitionItem } from 'obsidian';
import { describeError } from './actions';
import { checkConnection, detectChats } from './backup/connection';
import { DEFAULT_API_SERVER } from './constants';
import { TEMPLATE_PLACEHOLDERS } from './format/template';
import type TelegramBackupPlugin from './main';
import {
	applySetting,
	DEFAULT_CAPTION_TEMPLATE,
	isSettingKey,
	validateApiServer,
	validateChatId,
	validateTopicId,
	validateTrigger,
} from './settings';
import { chatTitle, type TgChat } from './telegram/types';
import { ChatPickerModal } from './ui/chat-picker-modal';
import { ConfirmModal } from './ui/confirm-modal';
import { HistoryModal } from './ui/history-modal';
import { plural } from './utils/format';
import { fromNow } from './utils/time';

const BOTFATHER_URL = 'https://t.me/BotFather';
const BOTFATHER_NAME = '@BotFather';
const PLACEHOLDER_EXAMPLE = '{{date:DD MMM YYYY}}';
const HTML_EXAMPLE = '<b>bold</b>';

function lines(texts: string[]): DocumentFragment {
	const fragment = createFragment();
	for (const text of texts) fragment.createDiv({ text });
	return fragment;
}

/**
 * Settings tab built from setting definitions (Obsidian 1.13+), so every
 * option also shows up in the global settings search.
 */
export class TelegramBackupSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: TelegramBackupPlugin,
	) {
		super(app, plugin);
		this.icon = 'send';
	}

	getControlValue(key: string): unknown {
		return isSettingKey(key) ? this.plugin.settings[key] : undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (!isSettingKey(key) || !applySetting(this.plugin.settings, key, value)) return;
		await this.plugin.saveSettings();
		this.refreshDomState();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const settings = (): TelegramBackupPlugin['settings'] => this.plugin.settings;
		const scheduled = (): boolean => settings().scheduledBackup;
		return [
			{
				type: 'group',
				heading: 'Connection',
				items: [
					{
						name: 'Bot token',
						desc: this.tokenHelp(),
						aliases: ['token', 'botfather', 'api key', 'secret'],
						control: { type: 'secret', key: 'botTokenSecret' },
					},
					{
						name: 'Chat ID',
						desc: 'The channel, group or private chat that receives the backups, for example -1001234567890 or @my_channel.',
						aliases: ['channel', 'group', 'destination'],
						control: { type: 'text', key: 'chatId', placeholder: '-1001234567890', validate: validateChatId },
					},
					{
						name: 'Find the chat ID',
						desc: 'Add the bot to your channel as an administrator, or send your bot a message, then select Detect.',
						render: (setting) => {
							setting.addButton((button) => button.setButtonText('Detect').onClick(() => this.detect(button)));
						},
					},
					{
						name: 'Topic ID',
						desc: 'Optional. In a group with topics, the number of the topic that receives the backups.',
						control: { type: 'text', key: 'topicId', placeholder: 'Optional', validate: validateTopicId },
					},
					{
						name: 'Check the connection',
						desc: 'Verify the bot token, the chat and the permissions of the bot.',
						render: (setting) => {
							setting.addButton((button) => button.setButtonText('Check').setCta().onClick(() => this.check(setting, button)));
							setting.addButton((button) => button.setButtonText('Send test message').onClick(() => this.plugin.actions.sendTestMessage()));
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Note backups',
				items: [
					{
						name: 'Send notes as',
						desc: 'A file is an exact copy that can be restored later. Text messages are easy to read in Telegram.',
						control: {
							type: 'dropdown',
							key: 'sendFormat',
							options: { file: 'A file (exact copy)', text: 'Text messages', auto: 'Text when short, a file when long' },
						},
					},
					{
						name: 'Text style',
						desc: 'How notes and snippets look when they are sent as text.',
						control: {
							type: 'dropdown',
							key: 'textStyle',
							options: { formatted: 'Formatted', plain: 'Plain text', code: 'Code block (easy to copy)' },
						},
					},
					{
						name: 'Leave out properties',
						desc: 'Do not include the properties block (frontmatter) of a note in text messages.',
						visible: () => settings().sendFormat !== 'file',
						control: { type: 'toggle', key: 'stripFrontmatter' },
					},
					{
						name: 'Caption template',
						desc: this.templateHelp(),
						aliases: ['header', 'placeholders', 'hashtags'],
						control: { type: 'textarea', key: 'captionTemplate', rows: 5, placeholder: DEFAULT_CAPTION_TEMPLATE },
					},
					{
						name: 'Reset the caption template',
						render: (setting) => {
							setting.addButton((button) => button.setButtonText('Reset').onClick(() => this.resetCaption()));
						},
					},
					{
						name: 'Attachments',
						desc: 'Images, PDFs and other files embedded in a note.',
						control: {
							type: 'dropdown',
							key: 'attachmentMode',
							options: { separate: 'Send as separate files', zip: 'Bundle with the note in a zip archive', none: 'Do not send' },
						},
					},
					{
						name: 'Send unchanged attachments again',
						desc: 'By default an attachment is sent again only after it changes.',
						visible: () => settings().attachmentMode === 'separate',
						control: { type: 'toggle', key: 'resendAttachments' },
					},
					{
						name: 'When a note is backed up again',
						desc: 'Updating the previous message keeps one message per note, but Telegram does not keep the replaced versions.',
						control: {
							type: 'dropdown',
							key: 'updateMode',
							options: { new: 'Post a new message (keep every version)', edit: 'Update the previous message' },
						},
					},
					{
						name: 'Add the note name to sent text',
						desc: 'Selections and lines sent with the send trigger end with the name of their note.',
						control: { type: 'toggle', key: 'snippetSource' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Triggers',
				items: [
					{
						name: 'Enable triggers',
						desc: 'Type a trigger anywhere in a note to act on it right away. The trigger text is removed from the note.',
						control: { type: 'toggle', key: 'triggersEnabled' },
					},
					{
						name: 'Backup trigger',
						desc: 'Backs up the whole note.',
						visible: () => settings().triggersEnabled,
						control: { type: 'text', key: 'backupTrigger', placeholder: ';;backup', validate: validateTrigger },
					},
					{
						name: 'Send trigger',
						desc: 'Sends only the current line, or the paragraph above it when the line is empty.',
						visible: () => settings().triggersEnabled,
						control: {
							type: 'text',
							key: 'sendTrigger',
							placeholder: ';;send',
							validate: (value) => {
								const error = validateTrigger(value);
								if (error) return error;
								if (value.trim() === settings().backupTrigger.trim()) return 'Use a different text than the backup trigger.';
								return undefined;
							},
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Automatic backups',
				items: [
					{
						name: 'Back up notes when they change',
						desc: 'Sends a note after you stop editing it. A note is never sent twice without changes.',
						control: { type: 'toggle', key: 'autoBackupOnChange' },
					},
					{
						name: 'Wait after the last change',
						desc: 'Minutes without edits before the note is sent.',
						visible: () => settings().autoBackupOnChange,
						control: { type: 'slider', key: 'autoBackupDelayMinutes', min: 1, max: 60, step: 1, displayFormat: (value) => `${value} min` },
					},
					{
						name: 'Scheduled vault backup',
						desc: 'Regularly sends the vault as zip archives while Obsidian is open.',
						control: { type: 'toggle', key: 'scheduledBackup' },
					},
					{
						name: 'Frequency',
						visible: scheduled,
						control: {
							type: 'dropdown',
							key: 'scheduledInterval',
							options: { '1': 'Every hour', '6': 'Every 6 hours', '12': 'Every 12 hours', '24': 'Every day', '168': 'Every week' },
						},
					},
					{
						name: 'What to back up',
						visible: scheduled,
						control: {
							type: 'dropdown',
							key: 'scheduledType',
							options: { full: 'The whole vault', changes: 'Only files changed since the last backup' },
						},
					},
					{
						name: 'Skip when nothing changed',
						desc: 'Do not send a full backup when no file changed since the previous one.',
						visible: () => scheduled() && settings().scheduledType === 'full',
						control: { type: 'toggle', key: 'scheduledSkipUnchanged' },
					},
					{
						name: 'Run on mobile devices',
						desc: 'Mobile apps are often paused in the background, so scheduled backups are off on mobile by default.',
						visible: scheduled,
						control: { type: 'toggle', key: 'scheduledOnMobile' },
					},
					{
						name: 'Last scheduled backup',
						visible: scheduled,
						render: (setting) => {
							setting.setDesc(this.lastScheduledText());
							setting.addButton((button) => button.setButtonText('Run now').onClick(() => this.runScheduledNow(setting, button)));
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Archives',
				items: [
					{
						name: 'Files in vault archives',
						desc: 'Used for vault backups and backups of changed files.',
						control: {
							type: 'dropdown',
							key: 'archiveScope',
							options: { all: 'Notes and attachments', notes: 'Notes, canvases and bases only' },
						},
					},
					{
						name: 'Include the configuration folder',
						desc: `Add the ${this.app.vault.configDir} folder (settings, themes and plugins) to full vault backups. The settings of other plugins can contain passwords and API keys.`,
						control: { type: 'toggle', key: 'includeConfigFolder' },
					},
					{
						name: 'Maximum archive size',
						desc: 'Larger backups are split into several archives. Telegram bots can upload files of up to 50 MB.',
						control: { type: 'slider', key: 'archivePartSizeMb', min: 5, max: 47, step: 1, displayFormat: (value) => `${value} MB` },
					},
				],
			},
			{
				type: 'group',
				heading: 'Exclusions',
				items: [
					{
						name: 'Excluded folders',
						desc: 'One folder per line. These folders are left out of automatic backups and archives.',
						control: { type: 'textarea', key: 'excludedFolders', rows: 4, placeholder: 'Private\nJournal/2026' },
					},
					{
						name: 'Excluded tags',
						desc: 'Notes with one of these tags are left out of automatic backups and archives. Separate tags with commas.',
						control: { type: 'text', key: 'excludedTags', placeholder: '#private, #no-backup' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Telegram messages',
				items: [
					{
						name: 'Send silently',
						desc: 'People in the chat get a notification without sound.',
						control: { type: 'toggle', key: 'silentMessages' },
					},
					{
						name: 'Protect content',
						desc: 'Prevent forwarding and saving of backup messages in Telegram. Restoring from inside Obsidian still works.',
						control: { type: 'toggle', key: 'protectContent' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Interface',
				items: [
					{
						name: 'Show status bar item',
						desc: 'Shows when the last backup happened. Desktop only.',
						control: { type: 'toggle', key: 'showStatusBar' },
					},
					{
						name: 'Show success notifications',
						desc: 'Errors are always shown.',
						control: { type: 'toggle', key: 'showSuccessNotices' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Advanced',
				items: [
					{
						name: 'Bot API server',
						desc: 'Change this only if you run your own Bot API server or use a proxy you trust. The bot token is sent to this server with every request.',
						aliases: ['proxy', 'server', 'address', 'blocked'],
						control: { type: 'text', key: 'apiServer', placeholder: DEFAULT_API_SERVER, validate: validateApiServer },
					},
					{
						name: 'History size',
						desc: 'How many backups the history keeps. Only backups in the history can be restored from inside Obsidian.',
						control: { type: 'slider', key: 'historyLimit', min: 50, max: 1000, step: 50 },
					},
					{
						name: 'Backup history',
						render: (setting) => {
							setting.setDesc(`${plural(this.plugin.state.history.length, 'entry', 'entries')} recorded.`);
							setting.addButton((button) => button.setButtonText('Open').onClick(() => new HistoryModal(this.app, this.plugin).open()));
							setting.addButton((button) => button.setButtonText('Clear').setDestructive().onClick(() => this.confirmClearHistory()));
						},
					},
				],
			},
		];
	}

	private tokenHelp(): DocumentFragment {
		const fragment = createFragment();
		fragment.appendText('Create a bot with ');
		fragment.createEl('a', { text: BOTFATHER_NAME, href: BOTFATHER_URL });
		fragment.appendText(' and save its token as a secret. Secrets stay on this device and are never stored in the vault.');
		return fragment;
	}

	private templateHelp(): DocumentFragment {
		const fragment = createFragment();
		fragment.appendText('Caption of backup files and header of text messages. Placeholders: ');
		TEMPLATE_PLACEHOLDERS.forEach((name, index) => {
			if (index > 0) fragment.appendText(' ');
			fragment.createEl('code', { text: `{{${name}}}` });
		});
		fragment.appendText('. Dates accept a Moment.js format, for example ');
		fragment.createEl('code', { text: PLACEHOLDER_EXAMPLE });
		fragment.appendText('. Telegram formatting such as ');
		fragment.createEl('code', { text: HTML_EXAMPLE });
		fragment.appendText(' works. Lines whose placeholders are all empty are left out.');
		return fragment;
	}

	private lastScheduledText(): string {
		const { state, settings } = this.plugin;
		if (!state.lastScheduledAt) return 'Not run yet.';
		const next = state.lastScheduledAt + Number(settings.scheduledInterval) * 60 * 60 * 1000;
		const nextText = next <= Date.now() ? 'soon' : fromNow(next);
		return `Last run ${fromNow(state.lastScheduledAt)}. Next run ${nextText}.`;
	}

	private async check(setting: Setting, button: ButtonComponent): Promise<void> {
		button.setDisabled(true);
		setting.setDesc('Checking…');
		try {
			const report = await checkConnection(this.plugin);
			setting.setDesc(lines(report.lines));
		} catch (error) {
			setting.setDesc(lines([`⚠️ ${describeError(error)}`]));
		} finally {
			button.setDisabled(false);
		}
	}

	private async detect(button: ButtonComponent): Promise<void> {
		button.setDisabled(true);
		try {
			const chats = await detectChats(this.plugin);
			if (chats.length === 0) {
				new Notice('No chats found yet. Post a message in your channel or send /start to your bot, then try again.', 10000);
				return;
			}
			new ChatPickerModal(this.app, chats, (chat) => void this.useChat(chat)).open();
		} catch (error) {
			new Notice(`Could not detect chats. ${describeError(error)}`, 10000);
		} finally {
			button.setDisabled(false);
		}
	}

	private async useChat(chat: TgChat): Promise<void> {
		this.plugin.settings.chatId = String(chat.id);
		if (chat.type !== 'supergroup' || !chat.is_forum) this.plugin.settings.topicId = '';
		await this.plugin.saveSettings();
		this.update();
		new Notice(`Backups will be sent to ${chatTitle(chat)}.`);
	}

	private async resetCaption(): Promise<void> {
		this.plugin.settings.captionTemplate = DEFAULT_CAPTION_TEMPLATE;
		await this.plugin.saveSettings();
		this.update();
	}

	private async runScheduledNow(setting: Setting, button: ButtonComponent): Promise<void> {
		button.setDisabled(true);
		try {
			await this.plugin.auto.runScheduledNow('manual');
		} finally {
			button.setDisabled(false);
			setting.setDesc(this.lastScheduledText());
		}
	}

	private confirmClearHistory(): void {
		new ConfirmModal(this.app, {
			title: 'Clear the backup history?',
			message: 'The backups stay in Telegram, but they can no longer be restored from inside Obsidian.',
			confirmText: 'Clear history',
			destructive: true,
			onConfirm: () => void this.clearHistory(),
		}).open();
	}

	private async clearHistory(): Promise<void> {
		this.plugin.state.history = [];
		await this.plugin.saveSettings();
		this.plugin.status?.refresh();
		this.update();
	}
}
