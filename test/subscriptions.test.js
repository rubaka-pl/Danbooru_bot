import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/services/store.js';
import { createUserData } from '../src/services/userData.js';
import {
    dateInZone, deliverForChat, latestPostId, runDigestIfDue, startDigestLoop, subTagsToQuery
} from '../src/services/subscriptions.js';
import { fakeClient, makePost, testConfig } from './helpers/fakes.js';

function fakeTelegram(fail) {
    const calls = [];
    const record = (method) => async (chatId, media) => {
        if (fail) throw fail;
        calls.push([method, chatId, media]);
        return method === 'sendMediaGroup' ? media.map((_, i) => ({ message_id: i })) : { message_id: 1 };
    };
    return { calls, sendPhoto: record('sendPhoto'), sendMediaGroup: record('sendMediaGroup') };
}

function setup({ client = fakeClient(), telegram = fakeTelegram() } = {}) {
    const store = new MemoryStore();
    const config = testConfig();
    config.subscriptions.timeZone = 'UTC';
    config.subscriptions.hour = 12;
    return { store, userData: createUserData(store), client, config, telegram };
}

test('subTagsToQuery и dateInZone', () => {
    assert.deepEqual(subTagsToQuery(['a', '-b', 'score:>5']), [
        { name: 'a', negated: false, meta: false, postCount: 0 },
        { name: 'b', negated: true, meta: false, postCount: 1 },
        { name: 'score:>5', negated: false, meta: true, postCount: 2 }
    ]);
    assert.equal(dateInZone(new Date('2024-01-01T23:30:00Z'), 'UTC'), '2024-01-01');
    assert.equal(dateInZone(new Date('2024-01-01T23:30:00Z'), 'Europe/Warsaw'), '2024-01-02');
});

test('latestPostId берёт самый свежий пост (без random)', async () => {
    const seen = [];
    const client = fakeClient({ posts: async (p) => (seen.push(p), [makePost({ id: 5 }), makePost({ id: 9 })]) });
    assert.equal(await latestPostId(client, [{ name: 'a', postCount: 0 }], 'general', 2), 9);
    assert.equal(seen[0].random, false);
    assert.equal(await latestPostId(fakeClient({ posts: async () => [] }), [], 'general', 2), 0);
});

test('deliverForChat: только новое, лучшие по score, блок-лист, lastId обновляется', async () => {
    const posts = [
        makePost({ id: 10, score: 1 }),
        makePost({ id: 11, score: 50 }),
        makePost({ id: 12, score: 30, tag_string: 'blocked_tag' }),
        makePost({ id: 5, score: 999 })
    ];
    const deps = setup({ client: fakeClient({ posts: async () => posts }) });
    await deps.userData.subscriptions.add(1, { tags: ['hatsune_miku'], rating: 'general', lastId: 9 });
    await deps.userData.blocklist.add(1, ['blocked_tag']);

    assert.equal(await deliverForChat(deps, 1), 1);
    const [[method, , media]] = deps.telegram.calls;
    assert.equal(method, 'sendMediaGroup');
    assert.deepEqual(media.map(m => m.media.match(/\/(\d+)\.jpg/)[1]), ['11', '10']);
    assert.match(media[0].caption, /Подписка:<\/b> hatsune_miku — новых: 2/);
    assert.equal((await deps.userData.subscriptions.list(1))[0].lastId, 12);

    // Второй раз — ничего нового
    assert.equal(await deliverForChat(deps, 1), 0);
    assert.equal(await deliverForChat(deps, 999), 0);
});

test('deliverForChat: одна новая картинка — отдельным сообщением с кнопками', async () => {
    const deps = setup({ client: fakeClient({ posts: async () => [makePost({ id: 20 })] }) });
    await deps.userData.subscriptions.add(1, { tags: ['a'], rating: 'general', lastId: 0 });
    await deliverForChat(deps, 1);
    assert.equal(deps.telegram.calls[0][0], 'sendPhoto');
});

test('runDigestIfDue: до часа рассылки, один раз в день, force', async (t) => {
    t.mock.method(console, 'log', () => {});
    const deps = setup({ client: fakeClient({ posts: async () => [makePost({ id: 100 }), makePost({ id: 101 })] }) });
    await deps.userData.subscriptions.add(1, { tags: ['a'], rating: 'general', lastId: 0 });

    assert.deepEqual(await runDigestIfDue(deps, { now: new Date('2024-01-01T11:59:00Z') }), { status: 'not_due' });
    assert.deepEqual(await runDigestIfDue(deps, { now: new Date('2024-01-01T12:00:00Z') }), { status: 'done', chats: 1, delivered: 1 });
    assert.deepEqual(await runDigestIfDue(deps, { now: new Date('2024-01-01T20:00:00Z') }), { status: 'not_due' });
    assert.equal((await runDigestIfDue(deps, { now: new Date('2024-01-01T20:00:00Z'), force: true })).status, 'done');
    assert.equal((await runDigestIfDue(deps, { now: new Date('2024-01-02T12:00:00Z') })).status, 'done');
});

test('runDigestIfDue: бот заблокирован пользователем → подписки удаляются', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    const blocked = Object.assign(new Error('Forbidden: bot was blocked by the user'), { response: { error_code: 403 } });
    const deps = setup({
        client: fakeClient({ posts: async () => [makePost({ id: 1 })] }),
        telegram: fakeTelegram(blocked)
    });
    await deps.userData.subscriptions.add(1, { tags: ['a'], rating: 'general', lastId: 0 });
    await deps.userData.subscriptions.add(2, { tags: ['a'], rating: 'general', lastId: 0 });
    deps.client.posts = async () => { throw new Error('other error'); };
    await runDigestIfDue(deps, { force: true });
    assert.deepEqual(await deps.userData.subscriptions.chats(), [1, 2]); // обычная ошибка — не удаляем

    deps.client.posts = async () => [makePost({ id: 1 })];
    await runDigestIfDue(deps, { force: true });
    assert.deepEqual(await deps.userData.subscriptions.chats(), []);
});

test('startDigestLoop: первая проверка через 30 секунд, дальше каждые 10 минут', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    t.mock.method(console, 'log', () => {});
    const deps = setup();
    const get = t.mock.method(deps.store, 'get');
    const stop = startDigestLoop(deps);
    t.mock.timers.tick(30_000);
    await new Promise(resolve => setImmediate(resolve));
    const first = get.mock.callCount();
    t.mock.timers.tick(10 * 60 * 1000);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(get.mock.callCount() >= first);
    stop();
});
