import { escapeAttribute, escapeHtml, flattenNestedCode, isValidTelegramHtml } from './html';

/**
 * A piece of a Telegram message. Every entry of `lines` is valid Telegram HTML
 * on its own, so blocks can be split at any line without breaking formatting.
 */
export type Block =
	| { kind: 'text'; lines: string[] }
	| { kind: 'quote'; lines: string[]; expandable: boolean }
	| { kind: 'pre'; text: string; language: string };

/* Private-use characters mark spans (links, code…) that are already rendered. */
const PH_OPEN = '';
const PH_CLOSE = '';
const PLACEHOLDER = /(\d+)/g;

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac', '3gp', 'aac', 'opus']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'mkv', 'webm', 'ogv', 'avi']);

const TASK_MARKERS: Record<string, string> = {
	' ': '☐',
	x: '☑',
	X: '☑',
	'-': '☒',
	'/': '◐',
	'>': '↪',
	'!': '❗',
	'?': '❓',
	'*': '⭐',
};

const HORIZONTAL_RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
const RULE_TEXT = '──────────';

function extension(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function splitOnce(text: string, separator: string): [string, string | undefined] {
	const index = text.indexOf(separator);
	return index === -1 ? [text, undefined] : [text.slice(0, index), text.slice(index + separator.length)];
}

function isWebUrl(url: string): boolean {
	return /^https?:\/\/\S+$/i.test(url);
}

function anchor(url: string, label: string): string {
	return `<a href="${escapeAttribute(url)}">${escapeHtml(label)}</a>`;
}

function fileNameFromUrl(url: string): string {
	const last = url.split(/[/?#]/).filter(Boolean).pop() ?? url;
	try {
		return decodeURIComponent(last);
	} catch {
		return last;
	}
}

/** `[[Note#Heading|Alias]]` → `Alias`, `[[Note#Heading]]` → `Note › Heading`. */
export function wikilinkLabel(target: string): string {
	const [link, alias] = splitOnce(target, '|');
	if (alias !== undefined && alias.trim()) return alias.trim();
	const [file, subpath] = splitOnce(link, '#');
	const name = file.replace(/\.md$/i, '').trim();
	if (!subpath) return name;
	if (subpath.startsWith('^')) return name || subpath;
	const heading = subpath.split('#').filter(Boolean).join(' › ');
	return name ? `${name} › ${heading}` : heading;
}

/** `![[photo.png|300]]` → `🖼 photo.png`. Text after `|` is a size or alt text, so the file name is shown. */
function embedLabel(target: string): string {
	const link = target.split('|')[0] ?? '';
	const ext = extension(link.split('#')[0]?.trim() ?? '');
	let icon = '📎';
	if (IMAGE_EXTENSIONS.has(ext)) icon = '🖼';
	else if (AUDIO_EXTENSIONS.has(ext)) icon = '🎵';
	else if (VIDEO_EXTENSIONS.has(ext)) icon = '🎬';
	else if (ext === 'pdf') icon = '📄';
	return `${icon} ${wikilinkLabel(link)}`;
}

/** Converts inline Markdown (emphasis, code, links, wikilinks…) to Telegram HTML. */
export function renderInline(source: string): string {
	const tokens: string[] = [];
	const keep = (html: string): string => `${PH_OPEN}${tokens.push(html) - 1}${PH_CLOSE}`;

	let text = source
		.replace(/%%.*?%%/g, '') // Obsidian comments are hidden in reading view.
		.replace(/\s\^[A-Za-z0-9-]+\s*$/, ''); // Block IDs.

	text = text
		.replace(/(`+)(.+?)\1(?!`)/g, (_m, _ticks: string, code: string) => keep(`<code>${escapeHtml(code)}</code>`))
		.replace(/!\[\[([^\]\n]+?)\]\]/g, (_m, target: string) => keep(escapeHtml(embedLabel(target))))
		.replace(/\[\[([^\]\n]+?)\]\]/g, (_m, target: string) => keep(escapeHtml(wikilinkLabel(target))))
		.replace(/!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_m, alt: string, url: string) => {
			const label = alt.trim() || fileNameFromUrl(url);
			return keep(isWebUrl(url) ? `🖼 ${anchor(url, label)}` : escapeHtml(`🖼 ${label}`));
		})
		.replace(/\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_m, label: string, url: string) =>
			keep(isWebUrl(url) ? anchor(url, label) : escapeHtml(label)),
		)
		.replace(/<(https?:\/\/[^>\s]+)>/g, (_m, url: string) => keep(anchor(url, url)))
		// Protect bare URLs so that `_` or `~~` inside them are not read as formatting.
		.replace(/https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/g, (url) => keep(escapeHtml(url)));

	text = escapeHtml(text)
		.replace(/\*\*\*(\S(?:.*?\S)?)\*\*\*/g, '<b><i>$1</i></b>')
		.replace(/\*\*(\S(?:.*?\S)?)\*\*/g, '<b>$1</b>')
		.replace(/(^|[^\p{L}\p{N}_])___(\S(?:.*?\S)?)___(?![\p{L}\p{N}_])/gu, '$1<b><i>$2</i></b>')
		.replace(/(^|[^\p{L}\p{N}_])__(\S(?:.*?\S)?)__(?![\p{L}\p{N}_])/gu, '$1<b>$2</b>')
		.replace(/~~(\S(?:.*?\S)?)~~/g, '<s>$1</s>')
		.replace(/==(\S(?:.*?\S)?)==/g, '<u>$1</u>')
		.replace(/(^|[^*\p{L}\p{N}])\*(\S(?:[^*]*?\S)?)\*(?![*\p{L}\p{N}])/gu, '$1<i>$2</i>')
		.replace(/(^|[^_\p{L}\p{N}])_(\S(?:[^_]*?\S)?)_(?![_\p{L}\p{N}])/gu, '$1<i>$2</i>');

	return text.replace(PLACEHOLDER, (_m, index: string) => tokens[Number(index)] ?? '');
}

/** Renders HTML for one line, falling back to the escaped source if the result is not valid. */
function safeHtml(html: string, source: string): string {
	const flattened = flattenNestedCode(html);
	return isValidTelegramHtml(flattened) ? flattened : escapeHtml(source);
}

function renderListItem(indent: string, marker: string, text: string): string {
	const width = indent.replace(/\t/g, '  ').length;
	const pad = ' '.repeat(Math.min(width, 16));
	const ordered = /^\d/.test(marker);
	let bullet = ordered ? marker : '•';
	let body = text;
	const task = /^\[(.)\](?:\s+(.*))?$/.exec(text);
	if (task) {
		const status = task[1] ?? ' ';
		const icon = TASK_MARKERS[status] ?? `[${status}]`;
		bullet = ordered ? `${marker} ${icon}` : icon;
		body = task[2] ?? '';
	}
	return `${pad}${escapeHtml(bullet)} ${safeHtml(renderInline(body), body)}`;
}

/** Renders one line of a paragraph, list or quote. */
function renderLine(raw: string): string {
	const heading = HEADING.exec(raw);
	if (heading) {
		const text = heading[2] ?? '';
		return safeHtml(`<b>${renderInline(text)}</b>`, text);
	}
	if (HORIZONTAL_RULE.test(raw)) return RULE_TEXT;
	const item = LIST_ITEM.exec(raw);
	if (item) return renderListItem(item[1] ?? '', item[2] ?? '-', item[3] ?? '');
	const line = raw.trimEnd();
	return safeHtml(renderInline(line), line);
}

function trimEmptyLines(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && (lines[start] ?? '').trim() === '') start++;
	while (end > start && (lines[end - 1] ?? '').trim() === '') end--;
	return lines.slice(start, end);
}

function renderQuote(rawLines: string[]): Block {
	const lines = trimEmptyLines(rawLines);
	const out: string[] = [];
	let expandable = false;
	let body = lines;
	const callout = /^\[!([^\]]+)\]([+-]?)\s*(.*)$/.exec(lines[0] ?? '');
	if (callout) {
		const type = (callout[1] ?? 'note').trim();
		expandable = callout[2] === '-';
		const title = (callout[3] ?? '').trim() || capitalize(type);
		out.push(safeHtml(`<b>${renderInline(title)}</b>`, title));
		body = lines.slice(1);
	}
	for (const line of body) out.push(line.trim() === '' ? '' : renderLine(line));
	return { kind: 'quote', lines: out, expandable };
}

function isClosingFence(line: string, marker: string): boolean {
	const match = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
	const fence = match?.[1] ?? '';
	return fence !== '' && fence[0] === marker[0] && fence.length >= marker.length;
}

function sanitizeLanguage(info: string): string {
	const word = info.trim().split(/\s+/)[0] ?? '';
	return /^[\w+#.-]{1,30}$/.test(word) ? word.toLowerCase() : '';
}

function isTableStart(lines: string[], index: number): boolean {
	return (lines[index] ?? '').includes('|') && TABLE_SEPARATOR.test(lines[index + 1] ?? '');
}

/**
 * Converts an Obsidian Markdown note into Telegram-ready blocks: headings
 * become bold, lists get bullets, tasks get check boxes, callouts become
 * quotes and code blocks and tables keep their exact text.
 */
export function markdownToBlocks(markdown: string): Block[] {
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	const blocks: Block[] = [];
	let paragraph: string[] = [];
	const flush = (): void => {
		if (paragraph.length > 0) blocks.push({ kind: 'text', lines: paragraph });
		paragraph = [];
	};

	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? '';
		const trimmed = line.trim();

		const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
		if (fence && !(fence[1]?.startsWith('`') && (fence[2] ?? '').includes('`'))) {
			flush();
			const marker = fence[1] ?? '```';
			const language = sanitizeLanguage(fence[2] ?? '');
			const body: string[] = [];
			i++;
			while (i < lines.length && !isClosingFence(lines[i] ?? '', marker)) {
				body.push(lines[i] ?? '');
				i++;
			}
			i++;
			blocks.push({ kind: 'pre', text: body.join('\n'), language });
			continue;
		}

		if (trimmed.startsWith('$$')) {
			flush();
			const body: string[] = [];
			const rest = trimmed.slice(2);
			const closeOnSameLine = rest.indexOf('$$');
			if (closeOnSameLine !== -1) {
				body.push(rest.slice(0, closeOnSameLine));
				i++;
			} else {
				if (rest) body.push(rest);
				i++;
				while (i < lines.length && !(lines[i] ?? '').includes('$$')) {
					body.push(lines[i] ?? '');
					i++;
				}
				if (i < lines.length) {
					const last = lines[i] ?? '';
					const before = last.slice(0, last.indexOf('$$'));
					if (before.trim()) body.push(before);
					i++;
				}
			}
			blocks.push({ kind: 'pre', text: body.join('\n').trim(), language: 'latex' });
			continue;
		}

		if (trimmed.startsWith('%%') && !trimmed.slice(2).includes('%%')) {
			// Multi-line comment: skip everything up to the closing %%.
			i++;
			while (i < lines.length && !(lines[i] ?? '').includes('%%')) i++;
			i++;
			continue;
		}

		if (trimmed === '') {
			flush();
			i++;
			continue;
		}

		if (isTableStart(lines, i)) {
			flush();
			const table: string[] = [];
			while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') {
				table.push(lines[i] ?? '');
				i++;
			}
			blocks.push({ kind: 'pre', text: table.join('\n'), language: '' });
			continue;
		}

		if (/^\s{0,3}>/.test(line)) {
			flush();
			const quote: string[] = [];
			while (i < lines.length && /^\s{0,3}>/.test(lines[i] ?? '')) {
				quote.push((lines[i] ?? '').replace(/^(?:\s{0,3}>\s?)+/, ''));
				i++;
			}
			blocks.push(renderQuote(quote));
			continue;
		}

		if (HEADING.test(line) || HORIZONTAL_RULE.test(line)) {
			flush();
			blocks.push({ kind: 'text', lines: [renderLine(line)] });
			i++;
			continue;
		}

		// Lines that render to nothing (for example only a %% comment %%) are skipped.
		const rendered = renderLine(line);
		if (rendered.trim() !== '') paragraph.push(rendered);
		i++;
	}
	flush();
	return blocks;
}

/** Plain text: paragraphs are kept, nothing is formatted. */
export function plainBlocks(text: string): Block[] {
	return text
		.replace(/\r\n?/g, '\n')
		.split(/\n[ \t]*\n/)
		.filter((paragraph) => paragraph.trim() !== '')
		.map((paragraph) => ({ kind: 'text' as const, lines: paragraph.split('\n').map((line) => escapeHtml(line.trimEnd())) }));
}

/** The whole note as a Markdown code block, so it can be copied from Telegram in one tap. */
export function codeBlocks(text: string): Block[] {
	const normalized = text.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
	return normalized ? [{ kind: 'pre', text: normalized, language: 'markdown' }] : [];
}
