import { deflateSync } from 'fflate';
import { crc32 } from './crc32';

/*
 * A small ZIP writer. Files are compressed one at a time, so the exact size of
 * an archive is known before it is written. That makes it possible to split a
 * vault into several standalone archives that each fit Telegram's upload limit.
 */

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
export const END_RECORD_SIZE = 22;
/** Entry limit of a ZIP file without ZIP64 extensions. */
export const MAX_ZIP_ENTRIES = 65535;
const UTF8_NAMES = 0x0800;
const VERSION = 20;

/** Formats that are already compressed; deflating them again only costs time. */
const STORED_EXTENSIONS = new Set([
	'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic', 'heif',
	'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac',
	'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi',
	'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'zst',
	'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'woff', 'woff2',
]);

const encoder = new TextEncoder();

export interface ZipEntry {
	name: Uint8Array;
	data: Uint8Array;
	method: 0 | 8;
	crc: number;
	size: number;
	time: number;
	date: number;
}

function toDosDateTime(timestamp: number): { time: number; date: number } {
	const d = new Date(Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now());
	const year = d.getFullYear();
	if (year < 1980) return { time: 0, date: (1 << 5) | 1 };
	return {
		time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
		date: ((Math.min(year, 2107) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
	};
}

function extensionOf(path: string): string {
	const dot = path.lastIndexOf('.');
	return dot > path.lastIndexOf('/') ? path.slice(dot + 1).toLowerCase() : '';
}

/** True for formats that are stored as-is because they are already compressed. */
export function isPrecompressed(path: string): boolean {
	return STORED_EXTENSIONS.has(extensionOf(path));
}

/** Compresses one file and prepares it for an archive. */
export function createEntry(path: string, content: Uint8Array, modified: number): ZipEntry {
	let data = content;
	let method: 0 | 8 = 0;
	if (content.length > 64 && !isPrecompressed(path)) {
		const deflated = deflateSync(content, { level: 6 });
		if (deflated.length < content.length) {
			data = deflated;
			method = 8;
		}
	}
	const { time, date } = toDosDateTime(modified);
	return { name: encoder.encode(path), data, method, crc: crc32(content), size: content.length, time, date };
}

/** Bytes an entry adds to an archive (local header, data and central directory record). */
export function entrySize(entry: ZipEntry): number {
	return LOCAL_HEADER_SIZE + CENTRAL_HEADER_SIZE + 2 * entry.name.length + entry.data.length;
}

export class ZipArchive {
	private readonly entries: ZipEntry[] = [];
	private total = END_RECORD_SIZE;

	/** Exact size of the archive {@link toBytes} will produce. */
	get size(): number {
		return this.total;
	}

	get count(): number {
		return this.entries.length;
	}

	add(entry: ZipEntry): void {
		if (this.entries.length >= MAX_ZIP_ENTRIES) throw new Error('A ZIP archive cannot hold more than 65535 files.');
		this.entries.push(entry);
		this.total += entrySize(entry);
	}

	toBytes(): Uint8Array {
		const out = new Uint8Array(this.total);
		const view = new DataView(out.buffer);
		const offsets: number[] = [];
		let pos = 0;

		for (const entry of this.entries) {
			offsets.push(pos);
			view.setUint32(pos, 0x04034b50, true);
			view.setUint16(pos + 4, VERSION, true);
			view.setUint16(pos + 6, UTF8_NAMES, true);
			view.setUint16(pos + 8, entry.method, true);
			view.setUint16(pos + 10, entry.time, true);
			view.setUint16(pos + 12, entry.date, true);
			view.setUint32(pos + 14, entry.crc, true);
			view.setUint32(pos + 18, entry.data.length, true);
			view.setUint32(pos + 22, entry.size, true);
			view.setUint16(pos + 26, entry.name.length, true);
			view.setUint16(pos + 28, 0, true);
			out.set(entry.name, pos + LOCAL_HEADER_SIZE);
			out.set(entry.data, pos + LOCAL_HEADER_SIZE + entry.name.length);
			pos += LOCAL_HEADER_SIZE + entry.name.length + entry.data.length;
		}

		const directoryStart = pos;
		this.entries.forEach((entry, index) => {
			view.setUint32(pos, 0x02014b50, true);
			view.setUint16(pos + 4, VERSION, true);
			view.setUint16(pos + 6, VERSION, true);
			view.setUint16(pos + 8, UTF8_NAMES, true);
			view.setUint16(pos + 10, entry.method, true);
			view.setUint16(pos + 12, entry.time, true);
			view.setUint16(pos + 14, entry.date, true);
			view.setUint32(pos + 16, entry.crc, true);
			view.setUint32(pos + 20, entry.data.length, true);
			view.setUint32(pos + 24, entry.size, true);
			view.setUint16(pos + 28, entry.name.length, true);
			view.setUint16(pos + 30, 0, true);
			view.setUint16(pos + 32, 0, true);
			view.setUint16(pos + 34, 0, true);
			view.setUint16(pos + 36, 0, true);
			view.setUint32(pos + 38, 0, true);
			view.setUint32(pos + 42, offsets[index] ?? 0, true);
			out.set(entry.name, pos + CENTRAL_HEADER_SIZE);
			pos += CENTRAL_HEADER_SIZE + entry.name.length;
		});

		view.setUint32(pos, 0x06054b50, true);
		view.setUint16(pos + 4, 0, true);
		view.setUint16(pos + 6, 0, true);
		view.setUint16(pos + 8, this.entries.length, true);
		view.setUint16(pos + 10, this.entries.length, true);
		view.setUint32(pos + 12, pos - directoryStart, true);
		view.setUint32(pos + 16, directoryStart, true);
		view.setUint16(pos + 20, 0, true);
		return out;
	}
}
