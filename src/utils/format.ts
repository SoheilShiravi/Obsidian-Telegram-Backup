const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Formats a byte count, for example `1.4 MB`. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit++;
	}
	const digits = unit === 0 || value >= 100 ? 0 : 1;
	return `${value.toFixed(digits)} ${UNITS[unit] ?? 'B'}`;
}

/** `1 file`, `3 files`. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`;
}

/** Shortens text to `max` UTF-16 units without splitting a surrogate pair. */
export function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	let end = Math.max(0, max - 1);
	const code = text.charCodeAt(end - 1);
	if (code >= 0xd800 && code <= 0xdbff) end -= 1;
	return text.slice(0, end) + '…';
}

/** Unique ID for history entries. */
export function createId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
