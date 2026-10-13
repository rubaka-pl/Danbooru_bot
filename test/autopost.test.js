import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adultAutopostDeps, autopostOnce, startAutopostLoop } from '../src/services/autopost.js';
import { MemoryHistory } from '../src/services/history.js';
import { MemoryStore } from '../src/services/store.js';
import { createChannelStats } from '../src/services/channelStats.js';
import { fakeClient, makePost, testConfig } from './helpers/fakes.js';

function fakeTelegram() {
    const calls = [];
    return {
        calls,
        async sendPhoto(chatId, media, options) { calls.push(['sendPhoto', chatId, media, options]); return { message_id: calls.length }; },
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
    randomSequence(t, [0.9, 0.9, 0.9, 0.01, 0]); // general, без лайков, без битвы, альбом, размер 5
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
    randomSequence(t, [0.9, 0.9, 0.9, 0.01, 0]);
    const deps = setup({ client: fakeClient({ posts: async () => [makePost()] }) });
    assert.equal(await autopostOnce(deps), 'posted');

    const config = testConfig();
    config.autopost.albumEvery = 0;
    randomSequence(t, [0.9, 0.9, 0.9, 0]);
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

// ---------- Фазы: свежак → вразнобой → паки ----------
import { currentPhase, TREND_WAVE_KEY } from '../src/services/autopost.js';
import { parseSchedule } from '../src/config.js';

const H = 60 * 60 * 1000;
const schedule = parseSchedule('fresh:2,mix:1,packs:1');

test('расписание: разбор и выключение', () => {
    assert.deepEqual(schedule, [{ name: 'fresh', hours: 2 }, { name: 'mix', hours: 1 }, { name: 'packs', hours: 1 }]);
    assert.equal(parseSchedule('off'), null);
    assert.equal(parseSchedule('fresh:2,lol:1'), null);
    assert.equal(parseSchedule('fresh:0'), null);
});

test('цикл: 2 часа свежак → час вразнобой → час паки → снова свежак', () => {
    const at = (hours) => currentPhase(new Date(hours * H), schedule);
    assert.deepEqual(at(0), { name: 'fresh', index: 0, endsAt: 2 * H });
    assert.equal(at(1.9).name, 'fresh');
    assert.equal(at(2.1).name, 'mix');
    assert.deepEqual(at(3.5), { name: 'packs', index: 2, endsAt: 4 * H });
    assert.deepEqual(at(4.1), { name: 'fresh', index: 3, endsAt: 6 * H });
    assert.equal(currentPhase(new Date(), null), null);
});

const phaseSetup = (client) => {
    const config = testConfig();
    config.autopost.schedule = schedule;
    config.autopost.trends = { enabled: true, perWave: 10 };
    config.autopost.intervalMs = 60_000;
    const deps = setup({ client, config });
    deps.store = new MemoryStore();
    return deps;
};

test('свежак: арты за последние 30 дней с подписью «Свежее»', async (t) => {
    randomSequence(t, [0.99]); // general, без тренда
    const deps = phaseSetup();
    assert.equal(await autopostOnce({ ...deps, now: new Date('2026-10-14T01:00:00Z') }), 'posted');
    const search = deps.client.calls.find(c => c[0] === 'posts')[1];
    assert.ok(search.tags.includes('date:>=2026-09-14'));
    assert.ok(search.tags.includes('score:>10'));
    assert.match(deps.telegram.calls[0][3]?.caption ?? '', /Свежее/);
});

test('свежак кончился — обычный пост', async (t) => {
    randomSequence(t, [0.99]);
    const client = fakeClient({ posts: async (p) => (client.calls.push(['posts', p]), p.tags.includes('score:>10') ? [] : [makePost()]) });
    const deps = phaseSetup(client);
    assert.equal(await autopostOnce({ ...deps, now: new Date(1 * H) }), 'posted');
    assert.ok(client.calls.at(-1)[1].tags.includes('score:>50'));
});

test('в свежак тренд выпадает вперемешку: шанс = осталось трендов / осталось постов', async (t) => {
    // 1-й random — рейтинг (0.99 → general), 2-й — бросок на тренд.
    // До конца фазы 1 час = 60 постов, трендов 10 → шанс ≈ 0.17
    randomSequence(t, [0.99, 0.1, 0]);
    const lucky = phaseSetup();
    assert.equal(await autopostOnce({ ...lucky, now: new Date(1 * H) }), 'posted');
    assert.deepEqual(lucky.client.calls[0], ['popular', { scale: 'day' }]);
    assert.deepEqual(await lucky.store.get(TREND_WAVE_KEY), { index: 0, count: 1 });

    t.mock.restoreAll();
    randomSequence(t, [0.99, 0.2, 0.99]);
    const regular = phaseSetup();
    await autopostOnce({ ...regular, now: new Date(1 * H) });
    assert.ok(!regular.client.calls.some(c => c[0] === 'popular'));
});

test('лимит трендов за фазу; новая фаза свежака — счёт заново; вне свежака трендов нет', async (t) => {
    randomSequence(t, [0.99, 0]);
    const deps = phaseSetup();

    await deps.store.set(TREND_WAVE_KEY, { index: 0, count: 10 });
    await autopostOnce({ ...deps, now: new Date(1 * H) });
    assert.ok(!deps.client.calls.some(c => c[0] === 'popular'));

    t.mock.restoreAll();
    randomSequence(t, [0.99, 0]);
    await autopostOnce({ ...deps, now: new Date(5 * H) }); // свежак, второй круг
    assert.ok(deps.client.calls.some(c => c[0] === 'popular'));
    assert.deepEqual(await deps.store.get(TREND_WAVE_KEY), { index: 3, count: 1 });

    deps.client.calls.length = 0;
    await autopostOnce({ ...deps, now: new Date(2.5 * H) }); // вразнобой
    assert.ok(!deps.client.calls.some(c => c[0] === 'popular'));
});

test('свежие тренды кончились — свежий пост', async (t) => {
    randomSequence(t, [0.99, 0]);
    const client = fakeClient({ popular: async () => [], posts: async (p) => (p.tags.includes('order:rank') ? [] : [makePost()]) });
    const deps = phaseSetup(client);
    assert.equal(await autopostOnce({ ...deps, now: new Date(1 * H) }), 'posted');
    assert.equal(await deps.store.get(TREND_WAVE_KEY), null);
});

test('паки: альбом примерно через раз, без битв', async (t) => {
    // general, без лайков, альбом (0.01 < 1/3), размер 5
    randomSequence(t, [0.9, 0.9, 0.01, 0]);
    const client = fakeClient({ posts: async (params) => (client.calls.push(['posts', params]), Array.from({ length: 10 }, () => makePost())) });
    const deps = phaseSetup(client);
    assert.equal(await autopostOnce({ ...deps, now: new Date(3.5 * H) }), 'album');
});

test('18+ канал: только explicit, в свой чат, без запрещённых тегов и без записи в статистику', async (t) => {
    randomSequence(t, [0.99]); // без лайков, без альбома
    const forbidden = makePost({ rating: 'e', tag_string: 'loli 1girl' });
    const ok = makePost({ rating: 'e', tag_string: '1girl nude' });
    const client = fakeClient({ posts: async (params) => (client.calls.push(['posts', params]), [forbidden, ok]) });
    const deps = setup({ client });
    const adult = adultAutopostDeps(deps);

    assert.equal(await autopostOnce(adult), 'posted');
    const [[, chatId, media]] = deps.telegram.calls;
    assert.equal(chatId, '@test_adult');
    assert.equal(media, ok.file_url);
    const search = client.calls.find(c => c[0] === 'posts')[1];
    assert.ok(search.tags.includes('rating:e') || !search.tags.some(tag => tag.startsWith('rating:')));
    assert.equal(adult.config.autopost.battleEvery, 0);
    assert.equal(adult.config.autopost.trends.enabled, false);
    assert.equal(deps.config.autopost.channelId, '@test_channel'); // основной конфиг не тронут

    // В статистику основного канала посты 18+ не попадают
    await deps.channelStats.updateReactions(1, 10);
    assert.equal((await deps.channelStats.top()).length, 0);
});

test('18+ канал: только запрещённые посты → empty', async (t) => {
    randomSequence(t, [0.99]);
    const client = fakeClient({ posts: async () => [makePost({ rating: 'e', tag_string: 'shota 1boy' })] });
    const deps = setup({ client });
    assert.equal(await autopostOnce(adultAutopostDeps(deps)), 'empty');
    assert.equal(deps.telegram.calls.length, 0);
});
