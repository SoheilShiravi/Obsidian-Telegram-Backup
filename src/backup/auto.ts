import { Platform, TFile, type TAbstractFile } from 'obsidian';
import { NOTE_EXTENSIONS } from '../constants';
import type TelegramBackupPlugin from '../main';
import type { BackupTrigger } from '../state';
import { createExclusionFilter } from './vault-files';

const TICK_INTERVAL_MS = 60 * 1000;
const FIRST_TICK_DELAY_MS = 30 * 1000;
/** Wait this long before retrying a scheduled backup that failed. */
const SCHEDULE_RETRY_MS = 15 * 60 * 1000;
/** Wait this long before retrying automatic note backups that failed. */
const PENDING_RETRY_MS = 5 * 60 * 1000;

/** Backs up notes after they change, retries failed backups and runs the scheduled vault backup. */
export class AutoBackup {
	private readonly timers = new Map<string, number>();
	private ticking = false;
	private lastPendingRetry = 0;

	constructor(private readonly plugin: TelegramBackupPlugin) {}

	/** Starts the scheduler. Call once the workspace layout is ready. */
	start(): void {
		const { plugin } = this;
		plugin.registerInterval(window.setInterval(() => void this.tick(), TICK_INTERVAL_MS));
		const first = window.setTimeout(() => void this.tick(), FIRST_TICK_DELAY_MS);
		plugin.register(() => window.clearTimeout(first));
	}

	/** Cancels backups that are waiting for their delay to pass. */
	stop(): void {
		for (const timer of this.timers.values()) window.clearTimeout(timer);
		this.timers.clear();
	}

	onModify(file: TAbstractFile): void {
		const { settings } = this.plugin;
		if (!settings.autoBackupOnChange || !(file instanceof TFile) || !NOTE_EXTENSIONS.has(file.extension)) return;
		if (!this.plugin.isConfigured()) return;
		this.schedule(file.path);
	}

	onRename(oldPath: string, newPath: string): void {
		const timer = this.timers.get(oldPath);
		if (timer === undefined) return;
		window.clearTimeout(timer);
		this.timers.delete(oldPath);
		this.schedule(newPath);
	}

	onDelete(path: string): void {
		const timer = this.timers.get(path);
		if (timer !== undefined) window.clearTimeout(timer);
		this.timers.delete(path);
	}

	/** Runs the scheduled backup now, regardless of when it last ran. Returns false if it failed. */
	async runScheduledNow(trigger: BackupTrigger): Promise<boolean> {
		const { plugin } = this;
		const { settings, state } = plugin;
		const now = Date.now();
		state.lastScheduledAttemptAt = now;
		plugin.requestSave();
		const kind = settings.scheduledType === 'changes' ? 'changes' : 'vault';
		const unchanged =
			kind === 'vault' &&
			trigger === 'scheduled' &&
			settings.scheduledSkipUnchanged &&
			state.changesBaseline > 0 &&
			!plugin.archives.hasChangesSince(state.changesBaseline);
		const ok = unchanged || (await plugin.actions.backupArchive({ kind }, trigger));
		if (ok) {
			state.lastScheduledAt = now;
			plugin.requestSave();
		}
		return ok;
	}

	private schedule(path: string): void {
		const existing = this.timers.get(path);
		if (existing !== undefined) window.clearTimeout(existing);
		const delay = this.plugin.settings.autoBackupDelayMinutes * 60 * 1000;
		this.timers.set(
			path,
			window.setTimeout(() => {
				this.timers.delete(path);
				void this.backUp(path);
			}, delay),
		);
	}

	private async backUp(path: string): Promise<boolean> {
		const { plugin } = this;
		const file = plugin.app.vault.getFileByPath(path);
		if (!file) {
			plugin.removePending(path);
			return true;
		}
		if (createExclusionFilter(plugin.app, plugin.settings)(file)) {
			plugin.removePending(path);
			return true;
		}
		return plugin.actions.backupFile(file, { trigger: 'auto' });
	}

	private async tick(): Promise<void> {
		if (this.ticking || !this.plugin.isConfigured()) return;
		this.ticking = true;
		try {
			await this.retryPending();
			await this.runScheduledIfDue();
		} finally {
			this.ticking = false;
		}
	}

	private async retryPending(): Promise<void> {
		const { plugin } = this;
		if (plugin.state.pendingAuto.length === 0 || Date.now() - this.lastPendingRetry < PENDING_RETRY_MS) return;
		this.lastPendingRetry = Date.now();
		for (const path of [...plugin.state.pendingAuto]) {
			if (this.timers.has(path)) continue;
			const ok = await this.backUp(path);
			if (!ok) break; // Still failing, probably offline: try again later.
		}
	}

	private async runScheduledIfDue(): Promise<void> {
		const { plugin } = this;
		const { settings, state } = plugin;
		if (!settings.scheduledBackup || (Platform.isMobile && !settings.scheduledOnMobile)) return;
		const now = Date.now();
		const interval = Number(settings.scheduledInterval) * 60 * 60 * 1000;
		if (now - state.lastScheduledAt < interval) return;
		if (now - state.lastScheduledAttemptAt < SCHEDULE_RETRY_MS) return;
		if (plugin.archives.isRunning) return;
		await this.runScheduledNow('scheduled');
	}
}
