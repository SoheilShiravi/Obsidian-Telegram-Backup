import { DEFAULT_API_SERVER } from './constants';

export type SendFormat = 'file' | 'text' | 'auto';
export type TextStyle = 'formatted' | 'plain' | 'code';
export type AttachmentMode = 'none' | 'separate' | 'zip';
export type UpdateMode = 'new' | 'edit';
export type ScheduledType = 'full' | 'changes';
export type ArchiveScope = 'all' | 'notes';

export interface TelegramBackupSettings {
	/** Name of the secret in Obsidian's secret storage that holds the bot token. */
	botTokenSecret: string;
	chatId: string;
	topicId: string;
	apiServer: string;

	sendFormat: SendFormat;
	textStyle: TextStyle;
	stripFrontmatter: boolean;
	captionTemplate: string;
	attachmentMode: AttachmentMode;
	resendAttachments: boolean;
	updateMode: UpdateMode;
	snippetSource: boolean;

	triggersEnabled: boolean;
	backupTrigger: string;
	sendTrigger: string;

	autoBackupOnChange: boolean;
	autoBackupDelayMinutes: number;
	scheduledBackup: boolean;
	/** Hours between scheduled backups, stored as text for the dropdown. */
	scheduledInterval: string;
	scheduledType: ScheduledType;
	scheduledSkipUnchanged: boolean;
	scheduledOnMobile: boolean;

	archiveScope: ArchiveScope;
	includeConfigFolder: boolean;
	archivePartSizeMb: number;

	excludedFolders: string;
	excludedTags: string;

	silentMessages: boolean;
	protectContent: boolean;

	showStatusBar: boolean;
	showSuccessNotices: boolean;
	historyLimit: number;
}

export const DEFAULT_CAPTION_TEMPLATE = ['📝 <b>{{title}}</b>', '📁 <code>{{path}}</code>', '🕒 {{datetime}}', '{{tags}}'].join('\n');

export const DEFAULT_SETTINGS: TelegramBackupSettings = {
	botTokenSecret: '',
	chatId: '',
	topicId: '',
	apiServer: DEFAULT_API_SERVER,

	sendFormat: 'file',
	textStyle: 'formatted',
	stripFrontmatter: true,
	captionTemplate: DEFAULT_CAPTION_TEMPLATE,
	attachmentMode: 'separate',
	resendAttachments: false,
	updateMode: 'new',
	snippetSource: true,

	triggersEnabled: true,
	backupTrigger: ';;backup',
	sendTrigger: ';;send',

	autoBackupOnChange: false,
	autoBackupDelayMinutes: 5,
	scheduledBackup: false,
	scheduledInterval: '24',
	scheduledType: 'full',
	scheduledSkipUnchanged: true,
	scheduledOnMobile: false,

	archiveScope: 'all',
	includeConfigFolder: false,
	archivePartSizeMb: 45,

	excludedFolders: '',
	excludedTags: '',

	silentMessages: false,
	protectContent: false,

	showStatusBar: true,
	showSuccessNotices: true,
	historyLimit: 300,
};

export type SettingKey = keyof TelegramBackupSettings;

const CHOICES: Partial<Record<SettingKey, readonly string[]>> = {
	sendFormat: ['file', 'text', 'auto'],
	textStyle: ['formatted', 'plain', 'code'],
	attachmentMode: ['none', 'separate', 'zip'],
	updateMode: ['new', 'edit'],
	scheduledInterval: ['1', '6', '12', '24', '168'],
	scheduledType: ['full', 'changes'],
	archiveScope: ['all', 'notes'],
};

const RANGES: Partial<Record<SettingKey, readonly [number, number]>> = {
	autoBackupDelayMinutes: [1, 60],
	archivePartSizeMb: [5, 47],
	historyLimit: [50, 1000],
};

export function isSettingKey(key: string): key is SettingKey {
	return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key);
}

/** Returns a valid value for `key`, or undefined when `value` is not acceptable. */
export function coerceSetting<K extends SettingKey>(key: K, value: unknown): TelegramBackupSettings[K] | undefined {
	const fallback = DEFAULT_SETTINGS[key];
	if (typeof value !== typeof fallback) return undefined;
	const choices = CHOICES[key];
	if (choices && !choices.includes(value as string)) return undefined;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) return undefined;
		const range = RANGES[key];
		const rounded = Math.round(value);
		return (range ? Math.min(range[1], Math.max(range[0], rounded)) : rounded) as TelegramBackupSettings[K];
	}
	return value as TelegramBackupSettings[K];
}

/** Merges stored settings with the defaults, dropping anything invalid. */
export function sanitizeSettings(raw: unknown): TelegramBackupSettings {
	const settings: TelegramBackupSettings = { ...DEFAULT_SETTINGS };
	if (typeof raw !== 'object' || raw === null) return settings;
	const stored = raw as Record<string, unknown>;
	for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
		assign(settings, key, coerceSetting(key, stored[key]));
	}
	return settings;
}

function assign<K extends SettingKey>(settings: TelegramBackupSettings, key: K, value: TelegramBackupSettings[K] | undefined): void {
	if (value !== undefined) settings[key] = value;
}

/** Writes one setting if the value is valid. Returns false when it was rejected. */
export function applySetting(settings: TelegramBackupSettings, key: SettingKey, value: unknown): boolean {
	const coerced = coerceSetting(key, value === null && typeof DEFAULT_SETTINGS[key] === 'string' ? '' : value);
	if (coerced === undefined) return false;
	assign(settings, key, coerced);
	return true;
}

export function validateChatId(value: string): string | void {
	const id = value.trim();
	if (id === '' || /^-?\d+$/.test(id) || /^@[A-Za-z][A-Za-z0-9_]{3,}$/.test(id)) return;
	return 'Use a numeric ID such as -1001234567890, or the @username of a public channel.';
}

export function validateTopicId(value: string): string | void {
	if (value.trim() === '' || /^\d+$/.test(value.trim())) return;
	return 'Use a number, or leave this empty.';
}

export function validateTrigger(value: string): string | void {
	const trigger = value.trim();
	if (trigger.length >= 3 && !/\s/.test(trigger)) return;
	return 'Use at least three characters without spaces.';
}

export function validateApiServer(value: string): string | void {
	if (/^https?:\/\/[^\s/]+/i.test(value.trim())) return;
	return 'Enter a full address such as https://api.telegram.org.';
}
