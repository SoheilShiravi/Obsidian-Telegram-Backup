import { getAllTags, getLinkpath, MarkdownView, TFile, Vault, type App, type TFolder } from 'obsidian';
import type { TelegramBackupSettings } from '../settings';
import { hasExcludedTag, isInFolders, parseFolderList, parseTagList } from '../utils/paths';
import type { ArchiveSource } from '../zip/archive-builder';

/** Reads a text file, preferring the content of an open editor so unsaved changes are included. */
export async function readFileText(app: App, file: TFile): Promise<string> {
	for (const leaf of app.workspace.getLeavesOfType('markdown')) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === file.path) return view.getViewData();
	}
	return app.vault.read(file);
}

/** Files embedded in a note, such as images and PDFs. Embedded notes are not included. */
export function resolveAttachments(app: App, file: TFile): TFile[] {
	const cache = app.metadataCache.getFileCache(file);
	const found = new Map<string, TFile>();
	for (const embed of cache?.embeds ?? []) {
		const target = app.metadataCache.getFirstLinkpathDest(getLinkpath(embed.link), file.path);
		if (target && target.extension !== 'md' && target.path !== file.path) found.set(target.path, target);
	}
	return [...found.values()];
}

/** Returns true for files that the user excluded by folder or tag. */
export type ExclusionFilter = (file: TFile) => boolean;

export function createExclusionFilter(app: App, settings: TelegramBackupSettings): ExclusionFilter {
	const folders = parseFolderList(settings.excludedFolders);
	const tags = parseTagList(settings.excludedTags);
	return (file) => {
		if (folders.length > 0 && isInFolders(file.path, folders)) return true;
		if (tags.length > 0 && file.extension === 'md') {
			const cache = app.metadataCache.getFileCache(file);
			if (cache && hasExcludedTag(getAllTags(cache) ?? [], tags)) return true;
		}
		return false;
	};
}

export function filesInFolder(folder: TFolder): TFile[] {
	const files: TFile[] = [];
	Vault.recurseChildren(folder, (child) => {
		if (child instanceof TFile) files.push(child);
	});
	return files;
}

export function fileSource(app: App, file: TFile): ArchiveSource {
	return {
		path: file.path,
		size: file.stat.size,
		mtime: file.stat.mtime,
		read: async () => new Uint8Array(await app.vault.readBinary(file)),
	};
}

const SKIPPED_CONFIG_FOLDERS = new Set(['node_modules', '.git']);

/**
 * Files in the configuration folder. The vault does not index this folder, so
 * it is read through the adapter.
 */
export async function configFolderSources(app: App): Promise<ArchiveSource[]> {
	const adapter = app.vault.adapter;
	const sources: ArchiveSource[] = [];
	const walk = async (folder: string): Promise<void> => {
		const listed = await adapter.list(folder);
		for (const path of listed.files) {
			const stat = await adapter.stat(path);
			if (!stat || stat.type !== 'file') continue;
			sources.push({
				path,
				size: stat.size,
				mtime: stat.mtime,
				read: async () => new Uint8Array(await adapter.readBinary(path)),
			});
		}
		for (const subfolder of listed.folders) {
			const name = subfolder.slice(subfolder.lastIndexOf('/') + 1);
			if (!SKIPPED_CONFIG_FOLDERS.has(name)) await walk(subfolder);
		}
	};
	await walk(app.vault.configDir);
	return sources;
}
