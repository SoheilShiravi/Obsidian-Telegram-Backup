import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkBlocks, splitPlain } from '../src/format/chunker';
import { decodeEntities, escapeHtml, flattenNestedCode, htmlToPlain, isValidTelegramHtml, visibleLength } from '../src/format/html';
import { codeBlocks, markdownToBlocks, plainBlocks, renderInline, wikilinkLabel } from '../src/format/markdown';
import { renderTemplate, type TemplateContext } from '../src/format/template';
import { countWords, stripFrontmatter } from '../src/format/text';

void test('escapeHtml and decodeEntities round-trip', () => {
	assert.equal(escapeHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
	assert.equal(decodeEntities('&amp;lt; &#65; &#x42; &quot;'), '&lt; A B "');
	assert.equal(htmlToPlain('<b>1 &lt; 2</b>'), '1 < 2');
	assert.equal(visibleLength('<a href="https://x.y">link</a>'), 4);
});

void test('isValidTelegramHtml accepts nested tags and rejects broken ones', () => {
	assert.equal(isValidTelegramHtml('<b>bold <i>both</i></b>'), true);
	assert.equal(isValidTelegramHtml('<pre><code class="language-js">x</code></pre>'), true);
	assert.equal(isValidTelegramHtml('<b>bold <i>both</b></i>'), false);
	assert.equal(isValidTelegramHtml('<div>unsupported</div>'), false);
	assert.equal(isValidTelegramHtml('<b>open'), false);
	assert.equal(isValidTelegramHtml('raw < sign'), false);
});

void test('flattenNestedCode turns code inside other entities into backticks', () => {
	assert.equal(flattenNestedCode('<b>run <code>npm test</code></b>'), '<b>run `npm test`</b>');
	assert.equal(flattenNestedCode('<code>alone</code>'), '<code>alone</code>');
	assert.equal(flattenNestedCode('<pre><code class="language-ts">x</code></pre>'), '<pre><code class="language-ts">x</code></pre>');
});

void test('renderInline converts emphasis, code and links', () => {
	assert.equal(renderInline('**bold**, *italic* and `code`'), '<b>bold</b>, <i>italic</i> and <code>code</code>');
	assert.equal(renderInline('***both*** ~~gone~~ ==marked=='), '<b><i>both</i></b> <s>gone</s> <u>marked</u>');
	assert.equal(renderInline('snake_case_name and 2*3*4 stay'), 'snake_case_name and 2*3*4 stay');
	assert.equal(renderInline('a < b && c'), 'a &lt; b &amp;&amp; c');
	assert.equal(renderInline('**سلام** دنیا'), '<b>سلام</b> دنیا');
	assert.equal(renderInline('visible %%hidden%% text'), 'visible  text');
	assert.equal(renderInline('end of line ^block-1'), 'end of line');
});

void test('renderInline handles Obsidian links and embeds', () => {
	assert.equal(renderInline('[[Note#Heading|Alias]] and [[Other note]]'), 'Alias and Other note');
	assert.equal(renderInline('![[photo.png|300]]'), '🖼 photo.png');
	assert.equal(renderInline('![[Lecture.pdf]]'), '📄 Lecture.pdf');
	assert.equal(renderInline('![[Embedded note]]'), '📎 Embedded note');
	assert.equal(renderInline('[site](https://example.com/a_b_c)'), '<a href="https://example.com/a_b_c">site</a>');
	assert.equal(renderInline('[local note](Other%20note.md)'), 'local note');
	assert.equal(renderInline('see https://x.com/a_b_c_d.'), 'see https://x.com/a_b_c_d.');
	assert.equal(renderInline('![diagram](https://img.example/d.png)'), '🖼 <a href="https://img.example/d.png">diagram</a>');
	assert.equal(wikilinkLabel('Note#Part one#Detail'), 'Note › Part one › Detail');
	assert.equal(wikilinkLabel('Note#^abc123'), 'Note');
});

void test('markdownToBlocks renders structure', () => {
	const note = [
		'# Title with `code`',
		'',
		'Some **text**.',
		'- item',
		'\t- [ ] open task',
		'- [x] done task',
		'1. first',
		'',
		'> [!warning]- Careful',
		'> body line',
		'',
		'```js',
		'const a = 1 < 2;',
		'```',
		'',
		'| a | b |',
		'| --- | --- |',
		'| 1 | 2 |',
		'',
		'---',
		'%%',
		'secret comment',
		'%%',
		'$$',
		'e = mc^2',
		'$$',
	].join('\n');
	const blocks = markdownToBlocks(note);
	assert.deepEqual(blocks[0], { kind: 'text', lines: ['<b>Title with `code`</b>'] });
	assert.deepEqual(blocks[1], {
		kind: 'text',
		lines: ['Some <b>text</b>.', '• item', '  ☐ open task', '☑ done task', '1. first'],
	});
	assert.deepEqual(blocks[2], { kind: 'quote', lines: ['<b>Careful</b>', 'body line'], expandable: true });
	assert.deepEqual(blocks[3], { kind: 'pre', text: 'const a = 1 < 2;', language: 'js' });
	assert.deepEqual(blocks[4], { kind: 'pre', text: '| a | b |\n| --- | --- |\n| 1 | 2 |', language: '' });
	assert.deepEqual(blocks[5], { kind: 'text', lines: ['──────────'] });
	assert.deepEqual(blocks[6], { kind: 'pre', text: 'e = mc^2', language: 'latex' });
	assert.equal(blocks.length, 7);
});

void test('markdownToBlocks skips lines that only contain a comment', () => {
	assert.deepEqual(markdownToBlocks('Visible\n%% hidden %%\nAlso visible'), [{ kind: 'text', lines: ['Visible', 'Also visible'] }]);
	assert.deepEqual(markdownToBlocks('%% only a comment %%'), []);
});

void test('markdownToBlocks keeps a heading like "C#" intact', () => {
	assert.deepEqual(markdownToBlocks('## C#'), [{ kind: 'text', lines: ['<b>C#</b>'] }]);
	assert.deepEqual(markdownToBlocks('## Closed ##'), [{ kind: 'text', lines: ['<b>Closed</b>'] }]);
});

void test('plainBlocks and codeBlocks', () => {
	assert.deepEqual(plainBlocks('a <b>\n\nc'), [
		{ kind: 'text', lines: ['a &lt;b&gt;'] },
		{ kind: 'text', lines: ['c'] },
	]);
	assert.deepEqual(codeBlocks('\n# Note\n\n'), [{ kind: 'pre', text: '# Note', language: 'markdown' }]);
	assert.deepEqual(codeBlocks('   '), []);
});

void test('splitPlain respects the limit and never splits surrogate pairs', () => {
	const text = '😀'.repeat(3000);
	const parts = splitPlain(text, 4001);
	assert.equal(parts.join(''), text);
	for (const part of parts) {
		assert.ok(part.length <= 4001);
		const last = part.charCodeAt(part.length - 1);
		assert.ok(!(last >= 0xd800 && last <= 0xdbff), 'part ends with a lone high surrogate');
	}
	assert.deepEqual(splitPlain('one two three', 8), ['one two', 'three']);
	assert.deepEqual(splitPlain('', 10), ['']);
});

void test('chunkBlocks puts the header first and keeps every chunk under the limit', () => {
	const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(10);
	const blocks = plainBlocks(Array.from({ length: 30 }, () => paragraph).join('\n\n'));
	const chunks = chunkBlocks(blocks, { limit: 4000, header: '<b>Header</b>', footer: '<i>footer</i>' });
	assert.ok(chunks.length > 1);
	assert.ok(chunks[0]?.startsWith('<b>Header</b>\n\n'));
	assert.ok(chunks[chunks.length - 1]?.endsWith('<i>footer</i>'));
	for (const chunk of chunks) {
		assert.ok(visibleLength(chunk) <= 4000, `chunk too long: ${visibleLength(chunk)}`);
		assert.ok(isValidTelegramHtml(chunk));
	}
	const words = chunks.map(htmlToPlain).join(' ').split(/\s+/).filter((w) => w === 'Lorem').length;
	assert.equal(words, 300);
});

void test('chunkBlocks splits long code blocks and keeps them formatted', () => {
	const code = Array.from({ length: 400 }, (_, i) => `console.log(${i}); // <tag> & more`).join('\n');
	const chunks = chunkBlocks([{ kind: 'pre', text: code, language: 'js' }], { limit: 4000 });
	assert.ok(chunks.length > 1);
	for (const chunk of chunks) {
		assert.ok(chunk.startsWith('<pre><code class="language-js">') && chunk.endsWith('</code></pre>'));
		assert.ok(visibleLength(chunk) <= 4000);
	}
	assert.equal(chunks.map(htmlToPlain).join('\n'), code);
});

void test('chunkBlocks splits a single very long line', () => {
	const chunks = chunkBlocks([{ kind: 'text', lines: [escapeHtml('x'.repeat(9000))] }], { limit: 4000 });
	assert.equal(chunks.length, 3);
	assert.equal(chunks.map(htmlToPlain).join(''), 'x'.repeat(9000));
});

const context: TemplateContext = {
	values: { title: 'A & <B>', path: 'Folder/A.md', tags: '', vault: 'My vault' },
	dates: { now: Date.UTC(2026, 9, 18, 12, 0), created: 0 },
	formatDate: (timestamp, format) => `${format}@${new Date(timestamp).getUTCFullYear()}`,
};

void test('renderTemplate escapes values, formats dates and drops empty lines', () => {
	const template = '📝 <b>{{title}}</b>\n{{tags}}\n🏷 {{ tags }}\n🕒 {{date:YYYY}} · {{datetime}}\n{{created}}\n{{unknown}}';
	assert.equal(
		renderTemplate(template, context),
		'📝 <b>A &amp; &lt;B&gt;</b>\n🕒 YYYY@2026 · YYYY-MM-DD HH:mm@2026\n{{unknown}}',
	);
});

void test('stripFrontmatter and countWords', () => {
	assert.equal(stripFrontmatter('---\ntags: [a]\n---\n\nBody text'), 'Body text');
	assert.equal(stripFrontmatter('---\r\ntitle: x\r\n---\r\nBody'), 'Body');
	assert.equal(stripFrontmatter('No properties\n---\nhere'), 'No properties\n---\nhere');
	assert.equal(countWords('---\ntags: [a]\n---\nHello world, سلام دنیا!\n```\nignored code\n```'), 4);
});
