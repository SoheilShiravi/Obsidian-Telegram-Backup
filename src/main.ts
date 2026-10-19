import { Notice, Plugin, requestUrl, TFile, TFolder, type TAbstractFile } from 'obsidian';
import { Actions } from './actions';
import { ArchiveBackup } from './backup/archives';
import { AutoBackup } from './backup/auto';
import { NoteBackup } from './backup/notes';
import { RestoreService } from './backup/restore';
import { TelegramSender } from './backup/sender';
import { registerCli } from './cli';
import { registerCommands, registerMenus } from './commands';
import { ConfigError } from './errors';
import { DEFAULT_SETTINGS, sanitizeSettings, type TelegramBackupSettings } from './settings';
import { TelegramBackupSettingTab } from './settings-tab';
import { createEmptyState, sanitizeState, type BackupState, type NewHistoryEntry } from './state';
import { TelegramClient, type ClientConfig } from './telegram/client';
import { triggerExtension, type Trigger } from './triggers';
import { StatusBarItem } from './ui/status-bar';
import { createId } from './utils/format';

const DATA_VERSION = 1;
const SAVE_DELAY_MS = 1000;
/** Background failures (automatic and scheduled backups) are announced at most this often. */
const BACKGROUND_ERROR_INTERVAL_MS = 15 * 60 * 1000;

/** Where backups are sent. */
export interface BackupTarget {
	chatId: string;
	topicId?: number;
}

interface StoredData {
	version?: unknown;
	settings?: unknown;
	state?: unknown;
}

export default class TelegramBackupPlugin extends Plugin {
	settings: TelegramBackupSettings = { ...DEFAULT_SETTINGS };
	state: BackupState = createEmptyState();
	client!: TelegramClient;
	sender!: TelegramSender;
	notes!: NoteBackup;
	archives!: ArchiveBackup;
	restore!: RestoreService;
	auto!: AutoBackup;
	actions!: Actions;
	status: StatusBarItem | null = null;

	private settingTab: TelegramBackupSettingTab | null = null;
	private saveTimer: number | null = null;
	private lastBackgroundError = 0;

	async onload(): Promise<void> {
		await this.loadStoredData();

		this.client = new TelegramClient(
			() => this.clientConfig(),
			(request) => requestUrl(request),
			{ onChatMigrated: (oldChatId, newChatId) => void this.onChatMigrated(oldChatId, newChatId) },
		);
		this.sender = new TelegramSender(this);
		this.notes = new NoteBackup(this);
		this.archives = new ArchiveBackup(this);
		this.restore = new RestoreService(this);
		this.auto = new AutoBackup(this);
		this.actions = new Actions(this);

		this.settingTab = new TelegramBackupSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		registerCommands(this);
		registerMenus(this);
		registerCli(this);
		this.registerEditorExtension(triggerExtension(this));
		this.addRibbonIcon('send', 'Back up current note to Telegram', () => this.backupActiveFile());

		this.updateStatusBar();
		this.registerInterval(window.setInterval(() => this.status?.refresh(), 60 * 1000));

		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on('modify', (file) => this.auto.onModify(file)));
			this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.onRename(file, oldPath)));
			this.registerEvent(this.app.vault.on('delete', (file) => this.onDelete(file)));
			this.auto.start();
		});
	}

	onunload(): void {
		this.auto?.stop();
		this.archives?.cancel();
		this.flushSave();
	}

	onUserEnable(): void {
		if (!this.isConfigured()) {
			new Notice('Connect your Telegram bot in the plugin settings to start backing up.', 10000);
		}
	}

	async onExternalSettingsChange(): Promise<void> {
		await this.loadStoredData();
		this.updateStatusBar();
		this.status?.refresh();
		this.settingTab?.update();
	}

	/** The bot token, read from Obsidian's secret storage. Empty when not set. */
	getBotToken(): string {
		const name = this.settings.botTokenSecret.trim();
		if (!name) return '';
		try {
			return (this.app.secretStorage.getSecret(name) ?? '').trim();
		} catch {
			return '';
		}
	}

	isConfigured(): boolean {
		return this.getBotToken() !== '' && this.settings.chatId.trim() !== '';
	}

	/** Returns the chat to send to, or throws a {@link ConfigError} explaining what is missing. */
	requireTarget(): BackupTarget {
		if (!this.getBotToken()) throw new ConfigError('Add your bot token in the Telegram Backup settings first.');
		const chatId = this.settings.chatId.trim();
		if (!chatId) throw new ConfigError('Add the chat ID in the Telegram Backup settings first.');
		const topic = Number(this.settings.topicId.trim());
		return { chatId, topicId: Number.isInteger(topic) && topic > 0 ? topic : undefined };
	}

	getTriggers(): Trigger[] {
		const backup = this.settings.backupTrigger.trim();
		const send = this.settings.sendTrigger.trim();
		const triggers: Trigger[] = [];
		if (backup) triggers.push({ kind: 'backup', text: backup });
		if (send && send !== backup) triggers.push({ kind: 'send', text: send });
		return triggers;
	}

	/** Saves settings and state right away and applies interface changes. */
	async saveSettings(): Promise<void> {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		await this.persist();
		this.updateStatusBar();
	}

	/** Saves state soon, batching frequent changes into one write. */
	requestSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.persist();
		}, SAVE_DELAY_MS);
	}

	addHistory(entry: NewHistoryEntry): void {
		this.state.history.unshift({ id: createId(), at: Date.now(), ...entry });
		this.trimHistory();
		this.requestSave();
		this.status?.refresh();
	}

	addPending(path: string): void {
		if (this.state.pendingAuto.includes(path)) return;
		this.state.pendingAuto.push(path);
		this.requestSave();
	}

	removePending(path: string): void {
		const index = this.state.pendingAuto.indexOf(path);
		if (index === -1) return;
		this.state.pendingAuto.splice(index, 1);
		this.requestSave();
	}

	/** Rate-limits notices about failed background backups so they do not pile up while offline. */
	shouldShowBackgroundError(): boolean {
		const now = Date.now();
		if (now - this.lastBackgroundError < BACKGROUND_ERROR_INTERVAL_MS) return false;
		this.lastBackgroundError = now;
		return true;
	}

	private clientConfig(): ClientConfig {
		return { token: this.getBotToken(), apiServer: this.settings.apiServer };
	}

	private backupActiveFile(): void {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice('Open a note to back it up.');
			return;
		}
		void this.actions.backupFile(file, { trigger: 'manual', force: true });
	}

	private async loadStoredData(): Promise<void> {
		const raw: unknown = await this.loadData();
		const data: StoredData = typeof raw === 'object' && raw !== null ? raw : {};
		this.settings = sanitizeSettings(data.settings);
		this.state = sanitizeState(data.state);
	}

	private async persist(): Promise<void> {
		this.trimHistory();
		await this.saveData({ version: DATA_VERSION, settings: this.settings, state: this.state });
	}

	private flushSave(): void {
		if (this.saveTimer === null) return;
		window.clearTimeout(this.saveTimer);
		this.saveTimer = null;
		void this.persist();
	}

	private trimHistory(): void {
		const limit = this.settings.historyLimit;
		if (this.state.history.length > limit) this.state.history = this.state.history.slice(0, limit);
	}

	private updateStatusBar(): void {
		if (this.settings.showStatusBar && !this.status) {
			this.status = new StatusBarItem(this, this.addStatusBarItem());
		} else if (!this.settings.showStatusBar && this.status) {
			this.status.destroy();
			this.status = null;
		}
	}

	/** Keeps records, pending retries and history pointing at renamed files. */
	private onRename(file: TAbstractFile, oldPath: string): void {
		const { state } = this;
		let changed = false;
		const move = (from: string, to: string): void => {
			const record = state.notes[from];
			if (record) {
				delete state.notes[from];
				state.notes[to] = record;
				changed = true;
			}
			const pending = state.pendingAuto.indexOf(from);
			if (pending !== -1) {
				state.pendingAuto[pending] = to;
				changed = true;
			}
			for (const entry of state.history) {
				if (entry.path !== from) continue;
				entry.path = to;
				if (entry.label === from) entry.label = to;
				changed = true;
			}
			this.auto.onRename(from, to);
		};

		if (file instanceof TFile) {
			move(oldPath, file.path);
		} else if (file instanceof TFolder) {
			const prefix = `${oldPath}/`;
			const paths = new Set<string>();
			for (const path of Object.keys(state.notes)) if (path.startsWith(prefix)) paths.add(path);
			for (const path of state.pendingAuto) if (path.startsWith(prefix)) paths.add(path);
			for (const entry of state.history) if (entry.path?.startsWith(prefix)) paths.add(entry.path);
			for (const path of paths) move(path, `${file.path}/${path.slice(prefix.length)}`);
		}
		if (changed) this.requestSave();
	}

	private onDelete(file: TAbstractFile): void {
		if (!(file instanceof TFile)) return;
		this.auto.onDelete(file.path);
		this.removePending(file.path);
		if (this.state.notes[file.path]) {
			// The history is kept, so a deleted note can still be restored from it.
			delete this.state.notes[file.path];
			this.requestSave();
		}
	}

	private async onChatMigrated(oldChatId: string, newChatId: string): Promise<void> {
		if (this.settings.chatId.trim() !== oldChatId) return;
		this.settings.chatId = newChatId;
		for (const record of Object.values(this.state.notes)) {
			if (record.chatId === oldChatId) record.chatId = newChatId;
		}
		await this.saveSettings();
		new Notice(`Telegram upgraded your group, so its chat ID changed to ${newChatId}. The setting was updated.`);
	}
}
