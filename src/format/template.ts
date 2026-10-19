import { escapeHtml } from './html';

export interface TemplateContext {
	/** Plain-text values; they are HTML-escaped when inserted. */
	values: Record<string, string>;
	/** Timestamps for date placeholders. */
	dates: { now: number; created?: number; modified?: number };
	formatDate: (timestamp: number, format: string) => string;
}

/** Placeholders shown in the settings, in display order. */
export const TEMPLATE_PLACEHOLDERS = [
	'title',
	'path',
	'folder',
	'vault',
	'tags',
	'date',
	'time',
	'datetime',
	'created',
	'modified',
	'words',
	'chars',
	'size',
] as const;

const DATE_FORMATS: Record<string, string> = {
	date: 'YYYY-MM-DD',
	time: 'HH:mm',
	datetime: 'YYYY-MM-DD HH:mm',
	created: 'YYYY-MM-DD HH:mm',
	modified: 'YYYY-MM-DD HH:mm',
};

const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)(?::([^}]*))?\s*\}\}/g;

function resolve(name: string, format: string | undefined, context: TemplateContext): string | undefined {
	const key = name.toLowerCase();
	const defaultFormat = DATE_FORMATS[key];
	if (defaultFormat !== undefined) {
		const timestamp = key === 'created' ? context.dates.created : key === 'modified' ? context.dates.modified : context.dates.now;
		if (!timestamp) return '';
		return escapeHtml(context.formatDate(timestamp, format?.trim() || defaultFormat));
	}
	const value = context.values[key];
	return value === undefined ? undefined : escapeHtml(value);
}

/**
 * Renders a caption template. The template may contain Telegram HTML such as
 * `<b>`; inserted values are escaped. A line whose placeholders are all empty
 * (for example a tags line for a note without tags) is removed.
 */
export function renderTemplate(template: string, context: TemplateContext): string {
	const output: string[] = [];
	for (const line of template.replace(/\r\n?/g, '\n').split('\n')) {
		let found = 0;
		let filled = 0;
		const rendered = line.replace(PLACEHOLDER, (match: string, name: string, format?: string) => {
			const value = resolve(name, format, context);
			if (value === undefined) return match;
			found++;
			if (value.trim() !== '') filled++;
			return value;
		});
		if (found > 0 && filled === 0) continue;
		output.push(rendered.trimEnd());
	}
	return output
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
