/*
 * Helpers for Telegram's HTML parse mode.
 * https://core.telegram.org/bots/api#html-style
 */

export function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttribute(text: string): string {
	return escapeHtml(text).replace(/"/g, '&quot;');
}

const TAG = /<(\/?)([a-zA-Z][\w-]*)(?:\s[^<>]*)?>/g;

export function stripTags(html: string): string {
	return html.replace(TAG, '');
}

/** Decodes the entities Telegram understands: &lt; &gt; &amp; &quot; and numeric ones. */
export function decodeEntities(text: string): string {
	return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|lt|gt|quot|amp);/g, (match, entity: string) => {
		switch (entity) {
			case 'lt':
				return '<';
			case 'gt':
				return '>';
			case 'quot':
				return '"';
			case 'amp':
				return '&';
		}
		const hex = entity[1] === 'x' || entity[1] === 'X';
		const code = hex ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
		return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
	});
}

/** The text a reader sees once Telegram has parsed the formatting. */
export function htmlToPlain(html: string): string {
	return decodeEntities(stripTags(html));
}

/** Length that counts against Telegram's limits (measured after entity parsing). */
export function visibleLength(html: string): number {
	return htmlToPlain(html).length;
}

const ALLOWED_TAGS = new Set([
	'b',
	'strong',
	'i',
	'em',
	'u',
	'ins',
	's',
	'strike',
	'del',
	'a',
	'code',
	'pre',
	'blockquote',
	'tg-spoiler',
	'span',
	'tg-emoji',
]);

/** Checks that only supported tags are used and that every tag is properly closed. */
export function isValidTelegramHtml(html: string): boolean {
	const stack: string[] = [];
	for (const match of html.matchAll(TAG)) {
		const name = (match[2] ?? '').toLowerCase();
		if (!ALLOWED_TAGS.has(name)) return false;
		if (match[1] === '/') {
			if (stack.pop() !== name) return false;
		} else {
			stack.push(name);
		}
	}
	if (stack.length > 0) return false;
	return !/[<>]/.test(stripTags(html));
}

/**
 * Telegram does not allow inline code inside other entities (for example bold
 * text that contains `code`). Such inner code spans are turned back into
 * backtick-quoted text so the message is still accepted.
 */
export function flattenNestedCode(html: string): string {
	const stack: string[] = [];
	let dropping = 0;
	return html.replace(TAG, (tag: string, slash: string, rawName: string) => {
		const name = rawName.toLowerCase();
		if (slash) {
			if (name === 'code' && dropping > 0) {
				dropping--;
				return '`';
			}
			stack.pop();
			return tag;
		}
		if (name === 'code' && stack.length > 0 && stack[stack.length - 1] !== 'pre') {
			dropping++;
			return '`';
		}
		stack.push(name);
		return tag;
	});
}
