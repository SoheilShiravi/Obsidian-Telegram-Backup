import { escapeHtml, htmlToPlain, isValidTelegramHtml, visibleLength } from './html';
import type { Block } from './markdown';

/** A rendered piece of a message that is never split further. */
interface Piece {
	html: string;
	/** Visible length after Telegram parses the HTML. */
	length: number;
}

export interface ChunkOptions {
	/** Maximum visible length of one message. */
	limit: number;
	/** HTML placed at the top of the first message. */
	header?: string;
	/** HTML placed at the end of the last message. */
	footer?: string;
}

const BLOCK_SEPARATOR = '\n\n';

/**
 * Splits plain text into parts of at most `limit` UTF-16 units, preferring
 * line breaks, then spaces, and never cutting a surrogate pair in half.
 */
export function splitPlain(text: string, limit: number): string[] {
	const parts: string[] = [];
	let rest = text;
	while (rest.length > limit) {
		let cut = rest.lastIndexOf('\n', limit);
		let skip = 1;
		if (cut < limit / 2) cut = rest.lastIndexOf(' ', limit);
		if (cut < limit / 2) {
			cut = limit;
			skip = 0;
			const code = rest.charCodeAt(cut - 1);
			if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
		}
		parts.push(rest.slice(0, cut));
		rest = rest.slice(cut + skip);
	}
	if (rest.length > 0 || parts.length === 0) parts.push(rest);
	return parts;
}

function htmlPieces(html: string, limit: number): Piece[] {
	const length = visibleLength(html);
	if (length <= limit) return [{ html, length }];
	return splitPlain(htmlToPlain(html), limit).map((part) => ({ html: escapeHtml(part), length: part.length }));
}

function linePieces(lines: string[], limit: number, wrap: (inner: string) => string): Piece[] {
	const pieces: Piece[] = [];
	let group: string[] = [];
	let groupLength = 0;
	const flush = (): void => {
		if (group.length > 0) pieces.push({ html: wrap(group.join('\n')), length: groupLength });
		group = [];
		groupLength = 0;
	};
	for (const line of lines) {
		for (const unit of htmlPieces(line, limit)) {
			const extra = group.length > 0 ? 1 : 0;
			if (group.length > 0 && groupLength + extra + unit.length > limit) flush();
			groupLength += (group.length > 0 ? 1 : 0) + unit.length;
			group.push(unit.html);
		}
	}
	flush();
	return pieces;
}

function prePieces(text: string, language: string, limit: number): Piece[] {
	if (text.trim() === '') return [];
	const wrap = (code: string): string =>
		language ? `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>` : `<pre>${escapeHtml(code)}</pre>`;
	return splitPlain(text, limit).map((part) => ({ html: wrap(part), length: part.length }));
}

function blockPieces(block: Block, limit: number): Piece[] {
	switch (block.kind) {
		case 'pre':
			return prePieces(block.text, block.language, limit);
		case 'text':
			return linePieces(block.lines, limit, (inner) => inner);
		case 'quote': {
			const open = block.expandable ? '<blockquote expandable>' : '<blockquote>';
			return linePieces(block.lines, limit, (inner) => `${open}${inner}</blockquote>`);
		}
	}
}

/**
 * Packs blocks into as few Telegram messages as possible. Each returned string
 * is valid Telegram HTML whose visible text is at most `limit` characters.
 */
export function chunkBlocks(blocks: Block[], options: ChunkOptions): string[] {
	const { limit } = options;
	const pieces: Piece[] = [];
	if (options.header?.trim()) pieces.push(...htmlPieces(options.header.trim(), limit));
	for (const block of blocks) pieces.push(...blockPieces(block, limit));
	if (options.footer?.trim()) pieces.push(...htmlPieces(options.footer.trim(), limit));

	const chunks: string[] = [];
	let current: string[] = [];
	let currentLength = 0;
	for (const piece of pieces) {
		const extra = current.length > 0 ? BLOCK_SEPARATOR.length : 0;
		if (current.length > 0 && currentLength + extra + piece.length > limit) {
			chunks.push(current.join(BLOCK_SEPARATOR));
			current = [];
			currentLength = 0;
		}
		currentLength += (current.length > 0 ? BLOCK_SEPARATOR.length : 0) + piece.length;
		current.push(piece.html);
	}
	if (current.length > 0) chunks.push(current.join(BLOCK_SEPARATOR));

	// Last line of defence: anything Telegram would reject is sent as plain text.
	return chunks.map((chunk) => (isValidTelegramHtml(chunk) ? chunk : escapeHtml(htmlToPlain(chunk))));
}
