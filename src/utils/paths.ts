/** Normalizes a user-entered folder path: forward slashes, no leading/trailing slash. */
export function cleanFolderPath(path: string): string {
	return path
		.trim()
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/')
		.replace(/^\/+|\/+$/g, '');
}

/** Parses the "excluded folders" setting: one folder per line. */
export function parseFolderList(text: string): string[] {
	const folders = text
		.split(/\r?\n/)
		.map(cleanFolderPath)
		.filter((folder) => folder.length > 0);
	return [...new Set(folders)];
}

/** True when `path` is one of `folders` or inside one of them. */
export function isInFolders(path: string, folders: string[]): boolean {
	const lower = path.toLowerCase();
	return folders.some((folder) => {
		const f = folder.toLowerCase();
		return lower === f || lower.startsWith(f + '/');
	});
}

/** Parses the "excluded tags" setting: tags separated by commas, spaces or new lines. */
export function parseTagList(text: string): string[] {
	const tags = text
		.split(/[\s,]+/)
		.map((tag) => tag.trim().replace(/^#+/, '').toLowerCase())
		.filter((tag) => tag.length > 0);
	return [...new Set(tags)];
}

/** True when any note tag equals an excluded tag or is nested below one (`#private/work`). */
export function hasExcludedTag(noteTags: string[], excluded: string[]): boolean {
	if (excluded.length === 0) return false;
	return noteTags.some((raw) => {
		const tag = raw.replace(/^#+/, '').toLowerCase();
		return excluded.some((ex) => tag === ex || tag.startsWith(ex + '/'));
	});
}

/**
 * Converts an Obsidian tag into a Telegram hashtag. Telegram hashtags may only
 * contain letters, digits and underscores, so `#project/sub-task` becomes
 * `#project_sub_task`.
 */
export function toHashtag(tag: string): string | null {
	let body = tag
		.replace(/^#+/, '')
		.replace(/[^\p{L}\p{N}_]+/gu, '_')
		.replace(/_{2,}/g, '_')
		.replace(/^_+|_+$/g, '');
	if (!body) return null;
	if (/^\d+$/.test(body)) body = `tag_${body}`;
	return `#${body}`;
}

/** Replaces characters that are not allowed in file names on common systems. */
export function sanitizeFileName(name: string): string {
	const cleaned = name
		.replace(/[\\/:*?"<>|]/g, '_')
		.replace(/\p{Cc}/gu, '')
		.replace(/\s+/g, ' ')
		.trim();
	return cleaned || 'backup';
}

export function extensionOf(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function parentFolder(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash === -1 ? '' : path.slice(0, slash);
}

/** File name without the folder and extension. */
export function baseName(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(0, dot) : name;
}
