/** Removes the YAML properties block (frontmatter) from the top of a note. */
export function stripFrontmatter(text: string): string {
	if (!/^---\r?\n/.test(text)) return text;
	const lines = text.split('\n');
	for (let i = 1; i < lines.length; i++) {
		const line = (lines[i] ?? '').replace(/\r$/, '');
		if (line === '---' || line === '...') {
			return lines
				.slice(i + 1)
				.join('\n')
				.replace(/^(?:[ \t]*\r?\n)+/, '');
		}
	}
	return text;
}

/** Approximate word count for captions. Code blocks and Markdown symbols are ignored. */
export function countWords(text: string): number {
	const cleaned = stripFrontmatter(text)
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/%%[\s\S]*?%%/g, ' ');
	const words = cleaned.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
	return words ? words.length : 0;
}

const encoder = new TextEncoder();

export function encodeUtf8(text: string): Uint8Array {
	return encoder.encode(text);
}

export function decodeUtf8(data: ArrayBuffer | Uint8Array): string {
	return new TextDecoder('utf-8').decode(data);
}
