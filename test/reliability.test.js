import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAlerts } from '../src/services/alerts.js';
import { createHealth } from '../src/services/health.js';
import { createHttpServer } from '../src/server.js';
import { CachedStore, MemoryStore } from '../src/services/store.js';
import { runContractChecks, formatContractReport } from '../src/services/danbooruContract.js';
import { hourlyQuota, recordSent } from '../src/bot/chatState.js';
import { startAutopostLoop } from '../src/services/autopost.js';
import { startDigestLoop } from '../src/services/subscriptions.js';
import { createUserData } from '../src/services/userData.js';
import { createChannelStats } from '../src/services/channelStats.js';
import { MemoryHistory } from '../src/services/history.js';
import { DanbooruError } from '../src/services/danbooru.js';
import { fakeClient, makePost, testConfig } from './helpers/fakes.js';

function fakeTelegram() {
    const sent = [];
    return { sent, sendMessage: async (chatId, text) => { sent.push([chatId, text]); return { message_id: 1 }; } };
}

test('alerts: только админам, с антиспамом, порог сбоев и восстановление', async () => {
    let clock = 0;
    const telegram = fakeTelegram();
    const alerts = createAlerts({ getTelegram: () => telegram, config: { adminIds: [1, 2] }, now: () => clock });

    assert.equal(await alerts.notify('k', 'проблема'), true);
    assert.deepEqual(telegram.sent.map(s => s[0]), [1, 2]);
    assert.equal(telegram.sent[0][1], '🚨 проблема');
    assert.equal(await alerts.notify('k', 'снова'), false); // антиспам
    clock += 31 * 60 * 1000;
    assert.equal(await alerts.notify('k', 'снова'), true);

    telegram.sent.length = 0;
    for (let i = 0; i < 4; i++) await alerts.failure('job', new Error('boom'), { label: 'Задача' });
    assert.equal(telegram.sent.length, 2); // на третьей ошибке, двум админам
    assert.match(telegram.sent[0][1], /Задача: 3 ошибок подряд.*\n.*boom/s);
    assert.equal(alerts.failures('job'), 4);

    await alerts.success('job', { label: 'Задача' });
    assert.match(telegram.sent.at(-1)[1], /^✅ Задача: снова работает \(после 4 ошибок\)/);
    assert.equal(alerts.failures('job'), 0);
    await alerts.success('job');
    assert.equal(alerts.failures('nothing'), 0);

    const silent = createAlerts({ getTelegram: () => { throw new Error('не должно вызываться'); }, config: { adminIds: [] } });
    assert.equal(await silent.notify('k', 'x'), false);

    const failingTelegram = { sendMessage: async () => { throw new Error('blocked'); } };
    const quiet = createAlerts({ getTelegram: () => failingTelegram, config: { adminIds: [1] } });
    await quiet.notify('k', 'x'); // не бросает
});

test('health: тишина, сбои, тихие часы и пауза', () => {
    let clock = 0;
    const health = createHealth({ now: () => clock });
    assert.equal(health.snapshot().ok, true);

    clock = 4 * 60 * 60 * 1000;
    assert.deepEqual([health.snapshot().ok, health.snapshot().reason], [false, 'no autoposts for too long']);
    assert.equal(health.snapshot({ autopostEnabled: false }).ok, true);

    health.markAutopost('quiet');
    assert.equal(health.snapshot().ok, true);
    health.markAutopost('posted');
    assert.equal(health.state.lastAutopostAt, clock);

    for (let i = 0; i < 20; i++) health.markAutopostError();
    assert.equal(health.snapshot().reason, 'autopost keeps failing');
    health.markAutopost('album');
    assert.equal(health.snapshot().ok, true);

    health.markUpdate();
    assert.equal(health.state.lastUpdateAt, clock);
    assert.equal(health.snapshot().uptimeSec, 4 * 60 * 60);
});

test('HTTP-сервер: / и /health (200 и 503)', async () => {
    let ok = true;
    const server = createHttpServer({
        health: { snapshot: () => ({ ok, reason: ok ? undefined : 'bad' }) },
        config: testConfig()
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    // node:http без keep-alive, чтобы не оставлять таймеров соединений
    const get = (path) => new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path, agent: false }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });
    try {
        assert.equal((await get('/')).body, 'Bot is running.');
        assert.equal((await get('/health')).status, 200);
        ok = false;
        const bad = await get('/health');
        assert.equal(bad.status, 503);
        assert.deepEqual(JSON.parse(bad.body), { ok: false, reason: 'bad' });
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});

test('CachedStore: читает из памяти, пишет пачкой, повторяет при ошибке', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const inner = new MemoryStore();
    await inner.set('a', 1);
    const calls = { get: 0, set: 0 };
    const origGet = inner.get.bind(inner);
    const origSet = inner.set.bind(inner);
    inner.get = async (k) => { calls.get++; return origGet(k); };
    inner.set = async (k, v, o) => { calls.set++; return origSet(k, v, o); };

    const store = new CachedStore(inner, { flushMs: 1000 });
    await store.load();
    assert.equal(await store.get('a'), 1);
    assert.equal(await store.get('a'), 1);
    assert.equal(calls.get, 1); // второй раз — из кэша
    assert.equal(await store.get('missing'), null);
    assert.equal(await store.get('missing'), null);
    assert.equal(calls.get, 2);

    await store.set('b', { x: 1 });
    await store.set('b', { x: 2 });
    await store.set('ttl', 5, { ttlSeconds: 100 });
    assert.equal(calls.set, 0);
    t.mock.timers.tick(1000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.set, 2); // b и ttl — по одной записи
    assert.deepEqual(await origGet('b'), { x: 2 });

    await store.del('b');
    assert.equal(await store.get('b'), null);
    assert.equal(await origGet('b'), null);

    await store.set('old', 1, { ttlSeconds: -1 });
    assert.equal(await store.get('old'), null);

    // Ошибка записи — ключ остаётся «грязным» и запишется позже
    inner.set = async () => { throw new Error('redis down'); };
    await store.set('c', 3);
    await assert.rejects(store.save(), /redis down/);
    inner.set = origSet;
    await store.save();
    assert.equal(await origGet('c'), 3);

    // Ошибка при фоновом сохранении только логируется
    t.mock.method(console, 'error', () => {});
    inner.set = async () => { throw new Error('redis down'); };
    await store.set('d', 4);
    t.mock.timers.tick(1000);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(String(console.error.mock.calls.at(-1).arguments[1]), /redis down/);
});

test('лимит картинок в час', () => {
    const chat = `quota-${Math.random()}`;
    const now = 1_000_000_000;
    assert.deepEqual(hourlyQuota(chat, 0, now), { limited: false, retryInMinutes: 0 });
    for (let i = 0; i < 3; i++) recordSent(chat, now + i * 60_000);
    assert.equal(hourlyQuota(chat, 5, now + 3 * 60_000).limited, false);
    const limited = hourlyQuota(chat, 3, now + 3 * 60_000);
    assert.deepEqual(limited, { limited: true, retryInMinutes: 57 });
    assert.equal(hourlyQuota(chat, 3, now + 61 * 60_000).limited, false); // первая картинка «истекла»
});

test('контракт Danbooru: всё хорошо, лимит, поломки', async () => {
    const good = {
        ...fakeClient(),
        posts: async ({ tags }) => {
            if (tags.length > 2) throw new DanbooruError('You cannot search for more than 2 tags at a time', 422);
            return [makePost()];
        },
        autocomplete: async () => [{ value: 'hatsune_miku' }],
        tagsFuzzy: async () => [{ name: 'hatsune_miku' }],
        similarToPost: async () => [{ postId: 1, score: 99 }]
    };
    const results = await runContractChecks(good);
    assert.ok(results.every(r => r.ok), formatContractReport(results));
    assert.match(formatContractReport(results), /✅ Поиск постов/);

    const broken = {
        ...good,
        posts: async () => [{ id: 1 }],
        tagByName: async () => null,
        autocomplete: async () => [],
        popular: async () => { throw new Error('404'); },
        wiki: async () => null,
        relatedTags: async () => []
    };
    const bad = await runContractChecks(broken);
    const failedRequired = bad.filter(r => r.required && !r.ok).map(r => r.name);
    assert.ok(failedRequired.includes('Поиск постов (posts.json, random)'));
    assert.ok(failedRequired.includes('Автодополнение (autocomplete.json)'));
    assert.match(formatContractReport(bad), /❌ Популярное.*404/);
    assert.match(formatContractReport(bad), /⚠️ Вики/);

    const noLimit = await runContractChecks({ ...good, posts: async () => [makePost()] });
    assert.match(noLimit.find(r => r.name.startsWith('Лимит')).details, /не сработал/);
    const otherError = await runContractChecks({ ...good, posts: async ({ tags }) => { if (tags.length > 2) throw new Error('500'); return [makePost()]; } });
    assert.equal(otherError.find(r => r.name.startsWith('Лимит')).ok, false);
});

test('цикл автопоста: уведомление админу после 3 сбоев и после 10 пустых', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'log', () => {});
    t.mock.method(Math, 'random', () => 0.99);
    const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

    const notes = [];
    const alerts = createAlerts({ getTelegram: () => ({ sendMessage: async (id, text) => notes.push(text) }), config: { adminIds: [1] } });
    const store = new MemoryStore();
    let mode = 'fail';
    const client = fakeClient({
        posts: async () => {
            if (mode === 'fail') throw new Error('Danbooru недоступен');
            return mode === 'empty' ? [] : [makePost()];
        }
    });
    const config = testConfig();
    config.autopost.intervalMs = 1000;
    config.autopost.maxBackoffMs = 1000;
    const health = createHealth();
    const stop = startAutopostLoop({
        telegram: { sendPhoto: async () => ({ message_id: 1 }) },
        client, history: new MemoryHistory(), config, store, channelStats: createChannelStats(store), alerts, health
    });

    t.mock.timers.tick(5000);
    await flush();
    for (let i = 0; i < 2; i++) { t.mock.timers.tick(1000); await flush(); }
    assert.match(notes.at(-1), /Автопост: 3 ошибок подряд/);
    assert.equal(health.state.autopostFailures, 3);

    mode = 'ok';
    t.mock.timers.tick(1000);
    await flush();
    assert.match(notes.at(-1), /✅ Автопост: снова работает/);
    assert.equal(health.state.lastAutopostResult, 'posted');

    mode = 'empty';
    for (let i = 0; i < 10; i++) { t.mock.timers.tick(1000); await flush(); }
    assert.match(notes.at(-1), /10 раз подряд не нашёл/);
    stop();
});

test('цикл подписок: ошибки идут в уведомления', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    t.mock.method(console, 'error', () => {});
    const failures = [];
    const store = new MemoryStore();
    store.get = async () => { throw new Error('store down'); };
    const deps = {
        store, userData: createUserData(store), config: testConfig(), client: fakeClient(),
        telegram: fakeTelegram(), channelStats: createChannelStats(store),
        alerts: { failure: async (key) => failures.push(key), success: async () => {} }
    };
    const stop = startDigestLoop(deps);
    t.mock.timers.tick(30_000);
    for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(failures, ['digest']); // «Топ недели» в «не тот» день хранилище не трогает
    stop();
});
