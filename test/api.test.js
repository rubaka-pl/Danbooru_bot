import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Эндпоинты Vercel создают приложение из конфига — задаём env до импорта
process.env.BOT_TOKEN = '123:TEST';
process.env.WEBHOOK_SECRET = 'hook-secret';
process.env.CRON_SECRET = 'cron-secret';
process.env.QUIET_HOURS = '00:00-23:59';
process.env.TZ_NAME = 'UTC';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;

const { mockTelegram } = await import('./helpers/fakes.js');
const { default: webhook } = await import('../api/webhook.js');
const { default: autopost } = await import('../api/autopost.js');
const { default: digest } = await import('../api/digest.js');

function res() {
    const r = {
        statusCode: 0, body: undefined,
        status(code) { r.statusCode = code; return r; },
        send(body) { r.body = body; return r; },
        json(body) { r.body = body; return r; }
    };
    return r;
}

let tg;
before(() => { tg = mockTelegram(); });
after(() => tg.restore());

test('webhook: GET — проверка жизни, неверный секрет — 401', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const alive = res();
    await webhook({ method: 'GET', headers: {} }, alive);
    assert.equal(alive.statusCode, 200);

    const denied = res();
    await webhook({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'wrong' }, body: {} }, denied);
    assert.equal(denied.statusCode, 401);
});

test('webhook: обрабатывает апдейт и всегда отвечает 200', async (t) => {
    t.mock.method(console, 'error', () => {});
    const ok = res();
    await webhook({
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': 'hook-secret' },
        body: { update_id: 1, message: { message_id: 1, date: 0, chat: { id: 5, type: 'private' }, from: { id: 5, is_bot: false, first_name: 'u' }, text: '/help', entities: [{ type: 'bot_command', offset: 0, length: 5 }] } }
    }, ok);
    assert.equal(ok.statusCode, 200);
    assert.ok(tg.calls('sendMessage').some(c => /Как писать запрос/.test(c.payload.text)));

    const broken = res();
    await webhook({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'hook-secret' }, body: null }, broken);
    assert.equal(broken.statusCode, 200);
});

test('autopost: авторизация и тихие часы', async () => {
    const denied = res();
    await autopost({ headers: {}, query: {} }, denied);
    assert.equal(denied.statusCode, 401);

    const quiet = res();
    await autopost({ headers: { authorization: 'Bearer cron-secret' }, query: {} }, quiet);
    assert.deepEqual([quiet.statusCode, quiet.body], [200, { ok: true, result: 'quiet' }]);

    const viaQuery = res();
    await autopost({ headers: {}, query: { secret: 'cron-secret' } }, viaQuery);
    assert.equal(viaQuery.statusCode, 200);
});

test('digest: авторизация и запуск без подписчиков', async (t) => {
    t.mock.method(console, 'log', () => {});
    const denied = res();
    await digest({ headers: {}, query: { secret: 'nope' } }, denied);
    assert.equal(denied.statusCode, 401);

    const forced = res();
    await digest({ headers: {}, query: { secret: 'cron-secret', force: '1' } }, forced);
    assert.deepEqual(forced.body, { ok: true, status: 'done', chats: 0, delivered: 0 });
});

test('autopost: выключен и ошибка', async (t) => {
    t.mock.method(console, 'error', () => {});
    const { config } = await import('../src/config.js');
    config.autopost.enabled = false;
    const disabled = res();
    await autopost({ headers: { authorization: 'Bearer cron-secret' }, query: {} }, disabled);
    assert.deepEqual(disabled.body, { ok: true, result: 'disabled' });
    config.autopost.enabled = true;

    config.autopost.quietHours = null;
    config.autopost.tags = ['score:>1'];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('offline'); };
    try {
        const failed = res();
        await autopost({ headers: { authorization: 'Bearer cron-secret' }, query: {} }, failed);
        assert.equal(failed.statusCode, 500);

        config.subscriptions.hour = 0;
        const digestFailed = res();
        const { MemoryStore } = await import('../src/services/store.js');
        const brokenGet = MemoryStore.prototype.get;
        MemoryStore.prototype.get = async () => { throw new Error('store down'); };
        try {
            await digest({ headers: { authorization: 'Bearer cron-secret' }, query: {} }, digestFailed);
        } finally {
            MemoryStore.prototype.get = brokenGet;
        }
        assert.deepEqual([digestFailed.statusCode, digestFailed.body.error], [500, 'store down']);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
