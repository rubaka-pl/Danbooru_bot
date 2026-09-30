import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autopostOnce, startAutopostLoop } from '../src/services/autopost.js';
import { MemoryHistory } from '../src/services/history.js';
import { MemoryStore } from '../src/services/store.js';
import { createChannelStats } from '../src/services/channelStats.js';
import { fakeClient, makePost, testConfig } from './helpers/fakes.js';

function fakeTelegram() {
    const calls = [];
    return {
        calls,
        async sendPhoto(chatId, media) { calls.push(['sendPhoto', chatId, media]); return { message_id: calls.length }; },
        async sendMediaGroup(chatId, media) { calls.push(['sendMediaGroup', chatId, media]); return media.map((_, i) => ({ message_id: 100 + i })); }
    };
}

function setup({ client = fakeClient(), config = testConfig() } = {}) {
    const store = new MemoryStore();
    return { telegram: fakeTelegram(), client, history: new MemoryHistory(), config, channelStats: createChannelStats(store) };
}

const randomSequence = (t, values) => {
    let i = 0;
    t.mock.method(Math, 'random', () => values[Math.min(i++, values.length - 1)]);
};

test('тихие часы: ничего не публикуется', async () => {
    const config = testConfig();
    config.autopost.quietHours = { start: '23:30', end: '06:00' };
    config.autopost.timeZone = 'UTC';
    const deps = setup({ config });
    assert.equal(await autopostOnce({ ...deps, now: new Date('2024-01-01T02:00:00Z') }), 'quiet');
    assert.equal(deps.telegram.calls.length, 0);
});

test('обычный пост: отправка в канал, история и статистика', async (t) => {
    randomSequence(t, [0.99]);
    const deps = setup();
    assert.equal(await autopostOnce(deps), 'posted');
    const [[method, chatId]] = deps.telegram.calls;
    assert.equal(method, 'sendPhoto');
    assert.equal(chatId, '@test_channel');
    assert.equal(deps.history.items.size, 1);
    const search = deps.client.calls.find(c => c[0] === 'posts')[1];
    assert.deepEqual(search.tags, ['score:>50', 'date:>=2017-01-01', 'rating:g']);
    assert.equal((await deps.channelStats.top()).length, 0); // пока нет реакций
});

test('всё уже публиковалось → empty', async (t) => {
    randomSequence(t, [0.99]);
    const post = makePost();
    const deps = setup({ client: fakeClient({ posts: async () => [post] }) });
    await deps.history.add(post.md5);
    assert.equal(await autopostOnce(deps), 'empty');
});

test('sensitive-рейтинг и пост по «залайканному» тегу', async (t) => {
    const deps = setup();
    await deps.channelStats.recordPost(1, makePost({ tag_string_character: 'rem', tag_string_copyright: '', tag_string_artist: '' }));
    await deps.channelStats.recordPost(2, makePost({ tag_string_character: 'rem', tag_string_copyright: '', tag_string_artist: '' }));
    await deps.channelStats.updateReactions(1, 5);

    // sensitive (0.1 < 1/5), liked (0.1 < 0.4), выбор тега, без альбома (0.9)
    randomSequence(t, [0.1, 0.1, 0.1, 0.9]);
    assert.equal(await autopostOnce(deps), 'posted');
    const search = deps.client.calls.find(c => c[0] === 'posts')[1];
    assert.deepEqual(search.tags, ['score:>20', 'rem', 'rating:s']);
});

test('альбом по теме случайного поста', async (t) => {
    randomSequence(t, [0.9, 0.9, 0.01, 0]); // general, без лайков, альбом, размер 5
    const client = fakeClient({ posts: async (params) => (client.calls.push(['posts', params]), Array.from({ length: 10 }, () => makePost())) });
    const deps = setup({ client });
    assert.equal(await autopostOnce(deps), 'album');
    const [method, , media] = deps.telegram.calls[0];
    assert.equal(method, 'sendMediaGroup');
    assert.equal(media.length, 5);
    assert.match(media[0].caption, /Подборка:<\/b> Hatsune Miku #hatsune_miku/);
    assert.equal(deps.history.items.size, 5);
    const themed = client.calls.filter(c => c[0] === 'posts')[1][1];
    assert.ok(themed.tags.includes('hatsune_miku'));
});

test('альбом не собрался (мало картинок) → обычный пост; альбомы можно выключить', async (t) => {
    randomSequence(t, [0.9, 0.9, 0.01, 0]);
    const deps = setup({ client: fakeClient({ posts: async () => [makePost()] }) });
    assert.equal(await autopostOnce(deps), 'posted');

    const config = testConfig();
    config.autopost.albumEvery = 0;
    randomSequence(t, [0.9, 0.9, 0]);
    const noAlbums = setup({ config });
    assert.equal(await autopostOnce(noAlbums), 'posted');
    assert.equal(noAlbums.telegram.calls[0][0], 'sendPhoto');
});

test('цикл автопоста: при 429 увеличивает паузу, после успеха возвращает', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'log', () => {});
    t.mock.method(Math, 'random', () => 0.99);

    let fail = true;
    const client = fakeClient({
        posts: async () => {
            if (fail) throw Object.assign(new Error('Too many'), { isRateLimit: true });
            return [makePost()];
        }
    });
    const deps = setup({ client });
    deps.config.autopost.intervalMs = 1000;
    deps.config.autopost.maxBackoffMs = 3000;
    const stop = startAutopostLoop(deps);
    const flush = () => new Promise(resolve => setImmediate(resolve));
    const lastError = () => console.error.mock.calls.map(c => String(c.arguments[0])).filter(m => m.includes('автопоста')).at(-1);

    t.mock.timers.tick(5000);
    await flush();
    assert.match(lastError(), /пауза 2 сек/);
    t.mock.timers.tick(2000);
    await flush();
    assert.match(lastError(), /пауза 3 сек/);

    fail = false;
    t.mock.timers.tick(3000);
    await flush();
    assert.equal(deps.telegram.calls.length, 1);
    stop();
});

test('цикл автопоста: пишет в лог начало и конец тихих часов', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const logs = [];
    t.mock.method(console, 'log', (msg) => logs.push(msg));
    t.mock.method(Math, 'random', () => 0.99);
    const config = testConfig();
    config.autopost.intervalMs = 1000;
    config.autopost.quietHours = { start: '00:00', end: '23:59' };
    config.autopost.timeZone = 'UTC';
    const deps = setup({ config });
    const stop = startAutopostLoop(deps);
    const flush = () => new Promise(resolve => setImmediate(resolve));

    t.mock.timers.tick(5000);
    await flush();
    assert.ok(logs.some(l => /Тихие часы — автопост на паузе/.test(l)));
    config.autopost.quietHours = null;
    t.mock.timers.tick(1000);
    await flush();
    assert.ok(logs.some(l => /Тихие часы закончились/.test(l)));
    stop();
});
