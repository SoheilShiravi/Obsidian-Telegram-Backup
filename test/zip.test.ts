import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzipSync } from 'fflate';
import { CancelledError } from '../src/errors';
import { buildArchives, type ArchivePart, type ArchiveSource } from '../src/zip/archive-builder';
import { crc32 } from '../src/zip/crc32';
import { createEntry, ZipArchive } from '../src/zip/zip-writer';

const encoder = new TextEncoder();

function randomBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	for (let offset = 0; offset < length; offset += 65536) {
		crypto.getRandomValues(bytes.subarray(offset, Math.min(length, offset + 65536)));
	}
	return bytes;
}

function source(path: string, data: Uint8Array): ArchiveSource {
	return { path, size: data.length, mtime: Date.UTC(2026, 9, 18), read: () => Promise.resolve(data) };
}

void test('crc32 matches the reference value', () => {
	assert.equal(crc32(encoder.encode('The quick brown fox jumps over the lazy dog')), 0x414fa339);
	assert.equal(crc32(new Uint8Array(0)), 0);
});

void test('ZipArchive writes archives that standard tools can read', () => {
	const files: Record<string, Uint8Array> = {
		'Notes/یادداشت سلام.md': encoder.encode('# سلام\n\nمتن فارسی'.repeat(50)),
		'Attachments/photo.png': randomBytes(5000),
		'big.txt': encoder.encode('repetitive line\n'.repeat(5000)),
		'tiny.md': encoder.encode('x'),
		'empty.md': new Uint8Array(0),
	};
	const archive = new ZipArchive();
	for (const [path, data] of Object.entries(files)) archive.add(createEntry(path, data, Date.UTC(2026, 9, 18, 10, 30)));
	const bytes = archive.toBytes();
	assert.equal(bytes.length, archive.size);
	assert.ok(bytes.length < 20000, 'repetitive text should be compressed');

	const unzipped = unzipSync(bytes);
	assert.deepEqual(Object.keys(unzipped).sort(), Object.keys(files).sort());
	for (const [path, data] of Object.entries(files)) assert.deepEqual(unzipped[path], data);
});

void test('buildArchives splits large backups into standalone parts', async () => {
	const sources = Array.from({ length: 30 }, (_, i) => source(`files/file-${String(i).padStart(2, '0')}.bin`, randomBytes(20000)));
	sources.push(source('huge.bin', randomBytes(150000)));
	const parts: ArchivePart[] = [];
	const summary = await buildArchives(sources, {
		partLimit: 100000,
		onPart: async (part) => {
			parts.push(part);
		},
	});

	assert.equal(summary.parts, parts.length);
	assert.ok(parts.length >= 7, `expected several parts, got ${parts.length}`);
	assert.equal(summary.files, 30);
	assert.deepEqual(
		summary.skipped.map((file) => file.path),
		['huge.bin'],
	);
	const names = new Set<string>();
	parts.forEach((part, index) => {
		assert.equal(part.index, index + 1);
		assert.equal(part.isLast, index === parts.length - 1);
		assert.ok(part.bytes.length <= 100000, `part ${part.index} is ${part.bytes.length} bytes`);
		const unzipped = unzipSync(part.bytes);
		assert.equal(Object.keys(unzipped).length, part.fileCount);
		for (const name of Object.keys(unzipped)) names.add(name);
	});
	assert.equal(names.size, 30);
});

void test('buildArchives produces nothing for an empty list and supports cancelling', async () => {
	const empty = await buildArchives([], { partLimit: 1000, onPart: () => Promise.reject(new Error('unexpected part')) });
	assert.equal(empty.parts, 0);

	let cancelled = false;
	const sources = Array.from({ length: 5 }, (_, i) => source(`f${i}.txt`, encoder.encode('data')));
	await assert.rejects(
		buildArchives(sources, {
			partLimit: 1000000,
			onPart: () => Promise.resolve(),
			onProgress: () => {
				cancelled = true;
			},
			isCancelled: () => cancelled,
		}),
		CancelledError,
	);
});
