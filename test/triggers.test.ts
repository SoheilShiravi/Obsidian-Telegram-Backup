import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState } from '@codemirror/state';
import { findTrigger, snippetAt, type Trigger } from '../src/triggers';

const triggers: Trigger[] = [
	{ kind: 'backup', text: ';;backup' },
	{ kind: 'send', text: ';;send' },
];

void test('findTrigger matches the text right before the cursor', () => {
	assert.equal(findTrigger('Some text ;;backup', triggers)?.kind, 'backup');
	assert.equal(findTrigger(';;send', triggers)?.kind, 'send');
	assert.equal(findTrigger(';;backu', triggers), null);
	assert.equal(findTrigger(';;backup and more', triggers), null);
});

void test('findTrigger prefers the longest trigger', () => {
	const overlapping: Trigger[] = [
		{ kind: 'send', text: 'up' },
		{ kind: 'backup', text: 'backup' },
	];
	assert.equal(findTrigger('please backup', overlapping)?.kind, 'backup');
});

void test('snippetAt sends the current line, or the paragraph above an empty line', () => {
	const doc = ['# Title', '', 'First line', 'second line', '', '', 'Buy milk', ''].join('\n');
	const state = EditorState.create({ doc });
	const lineStart = (n: number): number => state.doc.line(n).from;
	assert.equal(snippetAt(state, lineStart(7)), 'Buy milk');
	assert.equal(snippetAt(state, lineStart(8)), 'Buy milk');
	assert.equal(snippetAt(state, lineStart(5)), 'First line\nsecond line');
	assert.equal(snippetAt(EditorState.create({ doc: '\n\n' }), 1), '');
});
