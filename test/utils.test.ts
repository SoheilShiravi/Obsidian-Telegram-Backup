import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySetting, DEFAULT_SETTINGS, sanitizeSettings, validateApiServer, validateChatId, validateTrigger } from '../src/settings';
import { sanitizeState } from '../src/state';
import { formatBytes, plural, truncate } from '../src/utils/format';
import { hashBytes, hashString } from '../src/utils/hash';
import { mimeType } from '../src/utils/mime';
import {
	baseName,
	cleanFolderPath,
	extensionOf,
	hasExcludedTag,
	isInFolders,
	parentFolder,
	parseFolderList,
	parseTagList,
	sanitizeFileName,
	toHashtag,
} from '../src/utils/paths';

void test('folder exclusions match whole folder names only', () => {
	const folders = parseFolderList('Private\n /Journal/2026/ \n\nprivate\nArchive\\Old');
	assert.deepEqual(folders, ['Private', 'Journal/2026', 'private', 'Archive/Old']);
	assert.ok(isInFolders('Private/secret.md', folders));
	assert.ok(isInFolders('private', folders));
	assert.ok(isInFolders('Journal/2026/10/18.md', folders));
	assert.ok(!isInFolders('Private2/note.md', folders));
	assert.ok(!isInFolders('Journal/2025/note.md', folders));
	assert.equal(cleanFolderPath('//a//b/'), 'a/b');
});

void test('tag exclusions include nested tags', () => {
	const excluded = parseTagList('#private, no-backup  #Work/Secret');
	assert.deepEqual(excluded, ['private', 'no-backup', 'work/secret']);
	assert.ok(hasExcludedTag(['#private/finance'], excluded));
	assert.ok(hasExcludedTag(['#WORK/secret'], excluded));
	assert.ok(!hasExcludedTag(['#privateer', '#work'], excluded));
	assert.ok(!hasExcludedTag(['#private'], []));
});

void test('Obsidian tags become valid Telegram hashtags', () => {
	assert.equal(toHashtag('#project/sub-task'), '#project_sub_task');
	assert.equal(toHashtag('#2026'), '#tag_2026');
	assert.equal(toHashtag('#سفر/شمال'), '#سفر_شمال');
	assert.equal(toHashtag('#---'), null);
});

void test('path helpers', () => {
	assert.equal(sanitizeFileName('My: "vault"/2026?'), 'My_ _vault__2026_');
	assert.equal(sanitizeFileName('   '), 'backup');
	assert.equal(extensionOf('a/b.c/Note.MD'), 'md');
	assert.equal(extensionOf('a/.hidden'), '');
	assert.equal(parentFolder('a/b/c.md'), 'a/b');
	assert.equal(parentFolder('c.md'), '');
	assert.equal(baseName('a/b/c.tar.gz'), 'c.tar');
	assert.equal(mimeType('x.MD'), 'text/markdown');
	assert.equal(mimeType('x.unknown'), 'application/octet-stream');
});

void test('hashes are stable and sensitive to changes', () => {
	assert.equal(hashString('hello'), hashString('hello'));
	assert.notEqual(hashString('hello'), hashString('hello!'));
	assert.notEqual(hashBytes(new Uint8Array([1, 2, 3])), hashBytes(new Uint8Array([1, 2, 4])));
	assert.notEqual(hashBytes(new Uint8Array([0])), hashBytes(new Uint8Array([0, 0])));
});

void test('formatting helpers', () => {
	assert.equal(formatBytes(0), '0 B');
	assert.equal(formatBytes(1536), '1.5 KB');
	assert.equal(formatBytes(45 * 1024 * 1024), '45.0 MB');
	assert.equal(formatBytes(150 * 1024 * 1024), '150 MB');
	assert.equal(plural(1, 'file'), '1 file');
	assert.equal(plural(1200, 'file'), '1,200 files');
	assert.equal(plural(2, 'entry', 'entries'), '2 entries');
	assert.equal(truncate('abcdef', 4), 'abc…');
	assert.equal(truncate('a😀b', 3), 'a…');
	assert.equal(truncate('short', 10), 'short');
});

void test('sanitizeSettings keeps valid values and repairs the rest', () => {
	const settings = sanitizeSettings({
		chatId: '-100123',
		sendFormat: 'carrier pigeon',
		archivePartSizeMb: 500,
		autoBackupDelayMinutes: 2.6,
		showStatusBar: 'yes',
		unknownKey: true,
	});
	assert.equal(settings.chatId, '-100123');
	assert.equal(settings.sendFormat, DEFAULT_SETTINGS.sendFormat);
	assert.equal(settings.archivePartSizeMb, 47);
	assert.equal(settings.autoBackupDelayMinutes, 3);
	assert.equal(settings.showStatusBar, true);
	assert.ok(!('unknownKey' in settings));
	assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
});

void test('applySetting validates types and choices', () => {
	const settings = { ...DEFAULT_SETTINGS };
	assert.equal(applySetting(settings, 'sendFormat', 'text'), true);
	assert.equal(settings.sendFormat, 'text');
	assert.equal(applySetting(settings, 'sendFormat', 'fax'), false);
	assert.equal(applySetting(settings, 'silentMessages', 'true'), false);
	assert.equal(applySetting(settings, 'botTokenSecret', null), true);
	assert.equal(settings.botTokenSecret, '');
});

void test('setting validators', () => {
	assert.equal(validateChatId('-1001234567890'), undefined);
	assert.equal(validateChatId('@my_channel'), undefined);
	assert.equal(validateChatId(''), undefined);
	assert.ok(validateChatId('my channel'));
	assert.equal(validateTrigger(';;backup'), undefined);
	assert.ok(validateTrigger(';;'));
	assert.ok(validateTrigger('two words'));
	assert.equal(validateApiServer('https://api.telegram.org'), undefined);
	assert.ok(validateApiServer('api.telegram.org'));
});

void test('sanitizeState drops malformed entries', () => {
	const state = sanitizeState({
		lastScheduledAt: 5,
		changesBaseline: 'soon',
		pendingAuto: ['a.md', 3],
		notes: {
			'a.md': { hash: 'h', chatId: '1', format: 'file', messageIds: [1, 'x'], at: 1, attachments: { 'img.png': '1:2', bad: 5 } },
			'b.md': { hash: 'h', chatId: '1', format: 'pdf' },
		},
		history: [
			{ id: '1', at: 1, kind: 'note', label: 'a.md', ok: true, trigger: 'robot', size: 10 },
			{ id: '2', kind: 'unknown', label: 'x' },
			'garbage',
		],
	});
	assert.equal(state.lastScheduledAt, 5);
	assert.equal(state.changesBaseline, 0);
	assert.deepEqual(state.pendingAuto, ['a.md']);
	assert.deepEqual(Object.keys(state.notes), ['a.md']);
	assert.deepEqual(state.notes['a.md']?.messageIds, [1]);
	assert.deepEqual(state.notes['a.md']?.attachments, { 'img.png': '1:2' });
	assert.equal(state.history.length, 1);
	assert.equal(state.history[0]?.trigger, 'manual');
	assert.equal(state.history[0]?.size, 10);
});
