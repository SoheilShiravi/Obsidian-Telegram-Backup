export type DeliveryFormat = 'file' | 'text' | 'zip';
export type BackupTrigger = 'manual' | 'trigger' | 'auto' | 'scheduled' | 'cli';
export type HistoryKind = 'note' | 'snippet' | 'archive' | 'test';
export type ArchiveKind = 'vault' | 'changes' | 'folder' | 'items';

/** One line of the backup history. */
export interface HistoryEntry {
	id: string;
	at: number;
	kind: HistoryKind;
	label: string;
	trigger: BackupTrigger;
	ok: boolean;
	error?: string;
	/** Vault path of a backed-up note, used for restoring. */
	path?: string;
	archive?: ArchiveKind;
	format?: DeliveryFormat;
	link?: string;
	messageId?: number;
	chatId?: string;
	/** Telegram file ID of the uploaded document, used to download it again. */
	fileId?: string;
	fileName?: string;
	size?: number;
	parts?: number;
	files?: number;
	/** The previous message was edited instead of posting a new one. */
	updated?: boolean;
}

export type NewHistoryEntry = Omit<HistoryEntry, 'id' | 'at'>;

/** What was last sent for a note, used to skip unchanged notes and to edit old messages. */
export interface NoteRecord {
	hash: string;
	at: number;
	chatId: string;
	format: DeliveryFormat;
	messageIds: number[];
	link?: string;
	/** Telegram file ID of the last uploaded document. */
	fileId?: string;
	/** Attachment path → `size:mtime` signature of the version that was sent. */
	attachments?: Record<string, string>;
}

export interface BackupState {
	notes: Record<string, NoteRecord>;
	history: HistoryEntry[];
	lastScheduledAt: number;
	lastScheduledAttemptAt: number;
	/** Files modified after this time are included in a "changed files" backup. */
	changesBaseline: number;
	/** Notes whose automatic backup failed and will be retried. */
	pendingAuto: string[];
}

export function createEmptyState(): BackupState {
	return { notes: {}, history: [], lastScheduledAt: 0, lastScheduledAttemptAt: 0, changesBaseline: 0, pendingAuto: [] };
}

const KINDS: readonly string[] = ['note', 'snippet', 'archive', 'test'];
const TRIGGERS: readonly string[] = ['manual', 'trigger', 'auto', 'scheduled', 'cli'];
const FORMATS: readonly string[] = ['file', 'text', 'zip'];
const ARCHIVES: readonly string[] = ['vault', 'changes', 'folder', 'items'];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly string[]): T | undefined {
	return typeof value === 'string' && allowed.includes(value) ? (value as T) : undefined;
}

function sanitizeNoteRecord(value: unknown): NoteRecord | null {
	if (!isRecord(value) || typeof value.hash !== 'string' || typeof value.chatId !== 'string') return null;
	const format = oneOf<DeliveryFormat>(value.format, FORMATS);
	if (!format) return null;
	const record: NoteRecord = {
		hash: value.hash,
		at: num(value.at),
		chatId: value.chatId,
		format,
		messageIds: Array.isArray(value.messageIds) ? value.messageIds.filter((id): id is number => typeof id === 'number') : [],
		link: optionalString(value.link),
		fileId: optionalString(value.fileId),
	};
	if (isRecord(value.attachments)) {
		record.attachments = {};
		for (const [path, signature] of Object.entries(value.attachments)) {
			if (typeof signature === 'string') record.attachments[path] = signature;
		}
	}
	return record;
}

function sanitizeHistoryEntry(value: unknown): HistoryEntry | null {
	if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string') return null;
	const kind = oneOf<HistoryKind>(value.kind, KINDS);
	if (!kind) return null;
	return {
		id: value.id,
		at: num(value.at),
		kind,
		label: value.label,
		trigger: oneOf<BackupTrigger>(value.trigger, TRIGGERS) ?? 'manual',
		ok: value.ok === true,
		error: optionalString(value.error),
		path: optionalString(value.path),
		archive: oneOf<ArchiveKind>(value.archive, ARCHIVES),
		format: oneOf<DeliveryFormat>(value.format, FORMATS),
		link: optionalString(value.link),
		messageId: optionalNumber(value.messageId),
		chatId: optionalString(value.chatId),
		fileId: optionalString(value.fileId),
		fileName: optionalString(value.fileName),
		size: optionalNumber(value.size),
		parts: optionalNumber(value.parts),
		files: optionalNumber(value.files),
		updated: value.updated === true ? true : undefined,
	};
}

/** Restores saved state, dropping anything malformed. */
export function sanitizeState(raw: unknown): BackupState {
	const state = createEmptyState();
	if (!isRecord(raw)) return state;
	state.lastScheduledAt = num(raw.lastScheduledAt);
	state.lastScheduledAttemptAt = num(raw.lastScheduledAttemptAt);
	state.changesBaseline = num(raw.changesBaseline);
	if (Array.isArray(raw.pendingAuto)) {
		state.pendingAuto = raw.pendingAuto.filter((path): path is string => typeof path === 'string');
	}
	if (isRecord(raw.notes)) {
		for (const [path, value] of Object.entries(raw.notes)) {
			const record = sanitizeNoteRecord(value);
			if (record) state.notes[path] = record;
		}
	}
	if (Array.isArray(raw.history)) {
		for (const value of raw.history) {
			const entry = sanitizeHistoryEntry(value);
			if (entry) state.history.push(entry);
		}
	}
	return state;
}
