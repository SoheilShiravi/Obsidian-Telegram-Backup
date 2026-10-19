import { CancelledError } from '../errors';
import { delay } from '../utils/async';
import { createEntry, END_RECORD_SIZE, entrySize, isPrecompressed, MAX_ZIP_ENTRIES, ZipArchive } from './zip-writer';

export interface ArchiveSource {
	/** Path inside the archive (the vault-relative path). */
	path: string;
	size: number;
	mtime: number;
	read(): Promise<Uint8Array>;
}

export interface ArchivePart {
	/** 1-based part number. */
	index: number;
	bytes: Uint8Array;
	fileCount: number;
	/** False while more parts will follow. */
	isLast: boolean;
}

export interface SkippedFile {
	path: string;
	size: number;
	reason: 'too-large' | 'unreadable';
}

export interface ArchiveSummary {
	parts: number;
	files: number;
	originalBytes: number;
	archiveBytes: number;
	skipped: SkippedFile[];
}

export interface ArchiveBuildOptions {
	/** Maximum size of one archive file in bytes. */
	partLimit: number;
	/** Receives each finished archive. The next part is built only after this resolves. */
	onPart(part: ArchivePart): Promise<void>;
	onProgress?(done: number, total: number, part: number): void;
	isCancelled?(): boolean;
}

/**
 * Streams files into one or more standalone ZIP archives no larger than
 * `partLimit`. Only one archive is held in memory at a time.
 */
export async function buildArchives(sources: ArchiveSource[], options: ArchiveBuildOptions): Promise<ArchiveSummary> {
	const summary: ArchiveSummary = { parts: 0, files: 0, originalBytes: 0, archiveBytes: 0, skipped: [] };
	let archive = new ZipArchive();
	let lastYield = Date.now();

	const flush = async (isLast: boolean): Promise<void> => {
		const bytes = archive.toBytes();
		const fileCount = archive.count;
		archive = new ZipArchive();
		summary.parts++;
		summary.archiveBytes += bytes.length;
		await options.onPart({ index: summary.parts, bytes, fileCount, isLast });
	};

	for (let i = 0; i < sources.length; i++) {
		if (options.isCancelled?.()) throw new CancelledError();
		const source = sources[i];
		if (!source) continue;

		// Skip files that cannot fit before reading them: already-compressed formats
		// keep their size, and even plain text rarely compresses better than 8:1.
		const readLimit = isPrecompressed(source.path) ? options.partLimit : options.partLimit * 8;
		if (source.size > readLimit) {
			summary.skipped.push({ path: source.path, size: source.size, reason: 'too-large' });
			continue;
		}
		let content: Uint8Array;
		try {
			content = await source.read();
		} catch {
			summary.skipped.push({ path: source.path, size: source.size, reason: 'unreadable' });
			continue;
		}
		const entry = createEntry(source.path, content, source.mtime);
		const size = entrySize(entry);
		if (END_RECORD_SIZE + size > options.partLimit) {
			summary.skipped.push({ path: source.path, size: content.length, reason: 'too-large' });
			continue;
		}
		if (archive.count > 0 && (archive.size + size > options.partLimit || archive.count >= MAX_ZIP_ENTRIES)) {
			await flush(false);
		}
		archive.add(entry);
		summary.files++;
		summary.originalBytes += content.length;
		options.onProgress?.(i + 1, sources.length, summary.parts + 1);

		// Keep the interface responsive while compressing large vaults.
		if (Date.now() - lastYield > 50) {
			await delay(0);
			lastYield = Date.now();
		}
	}

	if (options.isCancelled?.()) throw new CancelledError();
	if (archive.count > 0) await flush(true);
	return summary;
}
