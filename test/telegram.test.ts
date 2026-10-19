import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { TelegramClient, type ClientOptions } from '../src/telegram/client';
import { isNotModifiedError, isParseError, NetworkError, TelegramApiError } from '../src/telegram/errors';
import { messageLink } from '../src/telegram/links';
import { buildMultipart } from '../src/telegram/multipart';

const TOKEN = '123456:ABC-secret-token';
const decoder = new TextDecoder();

function response(status: number, body: unknown): RequestUrlResponse {
	const text = typeof body === 'string' ? body : JSON.stringify(body);
	return {
		status,
		headers: {},
		text,
		get json(): unknown {
			return JSON.parse(text) as unknown;
		},
		arrayBuffer: new TextEncoder().encode(text).buffer,
	};
}

interface Harness {
	client: TelegramClient;
	requests: RequestUrlParam[];
	sleeps: number[];
	migrations: Array<[string, string]>;
}

/** A client whose network answers come from a queue of fake responses (or errors). */
function harness(answers: Array<RequestUrlResponse | Error>, options: Partial<ClientOptions> = {}): Harness {
	const requests: RequestUrlParam[] = [];
	const sleeps: number[] = [];
	const migrations: Array<[string, string]> = [];
	const client = new TelegramClient(
		() => ({ token: TOKEN, apiServer: 'https://api.example.org/' }),
		(request) => {
			requests.push(request);
			const answer = answers.shift();
			if (!answer) return Promise.reject(new Error('no more fake answers'));
			return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
		},
		{
			minSendIntervalMs: 0,
			sleep: (ms) => {
				sleeps.push(ms);
				return Promise.resolve();
			},
			onChatMigrated: (from, to) => migrations.push([from, to]),
			...options,
		},
	);
	return { client, requests, sleeps, migrations };
}

const ok = (result: unknown): RequestUrlResponse => response(200, { ok: true, result });
const message = { message_id: 7, date: 0, chat: { id: -1001234567890, type: 'channel' } };

void test('sends JSON requests to the configured server', async () => {
	const { client, requests } = harness([ok(message)]);
	const result = await client.sendMessage({ chat_id: '-1001234567890', text: 'hi', parse_mode: 'HTML', topic: undefined });
	assert.equal(result.message_id, 7);
	assert.equal(requests.length, 1);
	assert.equal(requests[0]?.url, `https://api.example.org/bot${TOKEN}/sendMessage`);
	assert.equal(requests[0]?.method, 'POST');
	assert.equal(requests[0]?.contentType, 'application/json');
	assert.equal(requests[0]?.throw, false);
	assert.deepEqual(JSON.parse(requests[0]?.body as string), { chat_id: '-1001234567890', text: 'hi', parse_mode: 'HTML' });
});

void test('waits and retries when rate limited', async () => {
	const { client, requests, sleeps } = harness([
		response(429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 2', parameters: { retry_after: 2 } }),
		ok(message),
	]);
	await client.sendMessage({ chat_id: '1', text: 'x' });
	assert.equal(requests.length, 2);
	assert.deepEqual(sleeps, [3000]);
});

void test('gives up on very long rate limits', async () => {
	const { client } = harness([response(429, { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 600 } })]);
	await assert.rejects(client.sendMessage({ chat_id: '1', text: 'x' }), (error: unknown) => {
		assert.ok(error instanceof TelegramApiError);
		assert.equal(error.retryAfter, 600);
		assert.match(error.message, /600 seconds/);
		return true;
	});
});

void test('retries server errors and network failures', async () => {
	const { client, requests } = harness([response(502, '<html>Bad gateway</html>'), new Error('net::ERR_CONNECTION_RESET'), ok(true)]);
	assert.equal(await client.deleteMessages('1', [1, 2]), true);
	assert.equal(requests.length, 3);
});

void test('reports network failures without leaking the token', async () => {
	const failure = new Error(`connect failed for https://api.example.org/bot${TOKEN}/getMe`);
	const { client, requests } = harness([failure, failure, failure]);
	await assert.rejects(client.getMe(), (error: unknown) => {
		assert.ok(error instanceof NetworkError);
		assert.ok(!error.message.includes(TOKEN));
		assert.match(error.message, /<bot-token>/);
		return true;
	});
	assert.equal(requests.length, 3);
});

void test('turns Telegram errors into helpful messages', async () => {
	const { client } = harness([response(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' })]);
	await assert.rejects(client.getChat('-100'), (error: unknown) => {
		assert.ok(error instanceof TelegramApiError);
		assert.equal(error.code, 400);
		assert.match(error.message, /Chat not found/);
		return true;
	});
	const unauthorized = harness([response(401, { ok: false, error_code: 401, description: 'Unauthorized' })]);
	await assert.rejects(unauthorized.client.getMe(), /rejected the bot token/);
});

void test('follows a group that was upgraded to a supergroup', async () => {
	const { client, requests, migrations } = harness([
		response(400, {
			ok: false,
			error_code: 400,
			description: 'Bad Request: group chat was upgraded to a supergroup chat',
			parameters: { migrate_to_chat_id: -1009876543210 },
		}),
		ok(message),
	]);
	await client.sendMessage({ chat_id: '-4242', text: 'x' });
	assert.deepEqual(migrations, [['-4242', '-1009876543210']]);
	assert.equal((JSON.parse(requests[1]?.body as string) as { chat_id: string }).chat_id, '-1009876543210');
});

void test('spaces out sending requests', async () => {
	const { client, sleeps } = harness([ok(message), ok(message)], { minSendIntervalMs: 1000 });
	await client.sendMessage({ chat_id: '1', text: 'a' });
	await client.sendMessage({ chat_id: '1', text: 'b' });
	assert.equal(sleeps.length, 1);
	assert.ok((sleeps[0] ?? 0) > 900 && (sleeps[0] ?? 0) <= 1000);
});

void test('uploads documents as multipart form data', async () => {
	const { client, requests } = harness([ok(message)]);
	await client.sendDocument(
		{ chat_id: '-100', caption: 'سلام', reply_parameters: { message_id: 3 }, protect_content: undefined },
		{ filename: 'یادداشت "1".md', data: new TextEncoder().encode('# body'), contentType: 'text/markdown' },
	);
	const request = requests[0];
	assert.ok(request?.contentType?.startsWith('multipart/form-data; boundary='));
	const body = decoder.decode(request?.body as ArrayBuffer);
	assert.match(body, /name="chat_id"\r\n\r\n-100\r\n/);
	assert.match(body, /name="caption"\r\n\r\nسلام\r\n/);
	assert.match(body, /name="reply_parameters"\r\n\r\n\{"message_id":3\}\r\n/);
	assert.match(body, /name="document"; filename="یادداشت %221%22\.md"\r\nContent-Type: text\/markdown\r\n\r\n# body\r\n/);
	assert.ok(!body.includes('protect_content'));
});

void test('buildMultipart closes the body with the boundary', () => {
	const { body, contentType } = buildMultipart({ a: '1' }, [], 'XYZ');
	assert.equal(contentType, 'multipart/form-data; boundary=XYZ');
	assert.equal(decoder.decode(body), '--XYZ\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--XYZ--\r\n');
});

void test('downloads files from the file endpoint', async () => {
	const { client, requests } = harness([response(200, 'file content')]);
	const data = await client.downloadFile('documents/file 1.md');
	assert.equal(decoder.decode(data), 'file content');
	assert.equal(requests[0]?.url, `https://api.example.org/file/bot${TOKEN}/documents/file%201.md`);
	assert.equal(requests[0]?.method, 'GET');
});

void test('recognizes formatting and not-modified errors', () => {
	assert.ok(isParseError(new TelegramApiError('sendMessage', 400, "Bad Request: can't parse entities: Unsupported start tag")));
	assert.ok(!isParseError(new TelegramApiError('sendMessage', 400, 'Bad Request: chat not found')));
	assert.ok(isNotModifiedError(new TelegramApiError('editMessageText', 400, 'Bad Request: message is not modified')));
	assert.ok(!isParseError(new Error("can't parse entities")));
});

void test('messageLink builds t.me links', () => {
	assert.equal(messageLink({ id: -1001234567890, type: 'channel' }, 5), 'https://t.me/c/1234567890/5');
	assert.equal(messageLink({ id: -1001234567890, type: 'channel', username: 'my_backups' }, 5), 'https://t.me/my_backups/5');
	assert.equal(messageLink({ id: 42, type: 'private', username: 'someone' }, 5), undefined);
	assert.equal(messageLink({ id: -4242, type: 'group' }, 5), undefined);
});
