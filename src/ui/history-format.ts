import type { BackupTrigger, DeliveryFormat, HistoryEntry, HistoryKind } from '../state';
import { formatBytes, plural } from '../utils/format';
import { formatDate } from '../utils/time';

export const KIND_ICONS: Record<HistoryKind, string> = {
	note: '📝',
	snippet: '✂️',
	archive: '🗄',
	test: '🔔',
};

const TRIGGER_LABELS: Record<BackupTrigger, string> = {
	manual: 'manual',
	trigger: 'typed trigger',
	auto: 'automatic',
	scheduled: 'scheduled',
	cli: 'command line',
};

const FORMAT_LABELS: Record<DeliveryFormat, string> = {
	file: 'file',
	text: 'text',
	zip: 'zip archive',
};

/** One-line summary of a history entry, for example `2026-10-18 14:05 · file · 12 KB · manual`. */
export function describeEntry(entry: HistoryEntry): string {
	const parts = [formatDate(entry.at, 'YYYY-MM-DD HH:mm')];
	if (entry.format) parts.push(FORMAT_LABELS[entry.format]);
	if (entry.parts !== undefined && entry.parts > 1) parts.push(plural(entry.parts, 'part'));
	if (entry.files !== undefined) parts.push(plural(entry.files, 'file'));
	if (entry.size !== undefined && entry.kind !== 'snippet') parts.push(formatBytes(entry.size));
	parts.push(TRIGGER_LABELS[entry.trigger]);
	if (entry.updated) parts.push('updated the previous message');
	return parts.join(' · ');
}
