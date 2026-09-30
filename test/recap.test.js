import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/services/store.js';
import { createChannelStats } from '../src/services/channelStats.js';
import { channelLink, formatRecap, runRecapIfDue, weekdayInZone } from '../src/services/recap.js';
import { autopostOnce, PAUSED_KEY } from '../src/services/autopost.js';
import { MemoryHistory } from '../src/services/history.js';
import { createUserData } from '../src/services/userData.js';
import { dtextToPlain } from '../src/utils/dtext.js';
import { enforceSafe, isAdult } from '../src/utils/ratings.js';
import { createDanbooruClient } from '../src/services/danbooru.js';
import { createTagResolver } from '../src/services/tagResolver.js';
import { fakeClient, jsonResponse, makePost, testConfig } from './helpers/fakes.js';

const DAY = 24 * 60 * 60 * 1000;

test('channelLink и weekdayInZone', () => {
    assert.equal(channelLink('@chan', 5), 'https://t.me/chan/5');
    assert.equal(channelLink(-1001234, 5), 'https://t.me/c/1234/5');
    assert.equal(channelLink(12345, 5), null);
    assert.equal(weekdayInZone(new Date('2024-06-02T12:00:00Z'), 'UTC'), 0); // воскресенье
    assert.equal(weekdayInZone(new Date('2024-06-02T23:30:00Z'), 'Europe/Warsaw'), 1); // уже понедельник
});

test('bestPosts: только за период и с реакциями, по убыванию', async () => {
    const stats = createChannelStats(new MemoryStore());
    const now = Date.now();
    await stats.recordPost(1, makePost(), { now: now - 10 * DAY }); // старый
    await stats.recordPost(2, makePost(), { now: now - DAY });
    await stats.recordPost(3, makePost(), { now: now - DAY });
    await stats.recordPost(4, makePost(), { now: now - DAY }); // без реакций
    for (const [id, n] of [[1, 50], [2, 3], [3, 9]]) await stats.updateReactions(id, n);

    const best = await stats.bestPosts({ now });
    assert.deepEqual(best.map(b => [b.messageId, b.reactions]), [[3, 9], [2, 3]]);
});

test('formatRecap: медали, ссылки и экранирование', () => {
    const text = formatRecap([
        { messageId: 1, postId: 10, reactions: 9, tags: ['rem_(re:zero)'] },
        { messageId: 2, postId: 11, reactions: 5, tags: ['a<b>'] },
        { messageId: 3, postId: 12, reactions: 4, tags: [] },
        { messageId: 4, postId: 13, reactions: 1 }
    ], 12345);
    assert.match(text, /🥇 Rem \(Re:zero\) — ❤️ 9/);
    assert.match(text, /🥈 A&lt;b&gt;/);
    assert.match(text, /🥉 Пост 12/);
    assert.match(text, /4\. Пост 13/);

    assert.match(formatRecap([{ messageId: 7, postId: 1, reactions: 1, tags: ['x'] }], '@c'), /href="https:\/\/t\.me\/c\/7"/);
});

test('runRecapIfDue: день недели, час, раз в неделю, выключение', async (t) => {
    t.mock.method(console, 'log', () => {});
    const store = new MemoryStore();
    const channelStats = createChannelStats(store);
    const sent = [];
    const telegram = { sendMessage: async (chatId, text) => sent.push([chatId, text]) };
    const config = testConfig();
    config.recap = { enabled: true, weekday: 0, hour: 20, timeZone: 'UTC' };
    const deps = { telegram, config, channelStats, store };

    const sunday = new Date('2024-06-02T20:30:00Z');
    await channelStats.recordPost(1, makePost(), { now: sunday.getTime() - DAY });
    await channelStats.updateReactions(1, 3);

    assert.equal(await runRecapIfDue(deps, { now: new Date('2024-06-03T20:30:00Z') }), 'not_due'); // понедельник
    assert.equal(await runRecapIfDue(deps, { now: new Date('2024-06-02T19:00:00Z') }), 'not_due'); // рано
    assert.equal(await runRecapIfDue(deps, { now: sunday }), 'posted');
    assert.equal(sent[0][0], '@test_channel');
    assert.equal(await runRecapIfDue(deps, { now: new Date('2024-06-02T22:00:00Z') }), 'not_due'); // уже было

    const empty = { ...deps, store: new MemoryStore(), channelStats: createChannelStats(new MemoryStore()) };
    assert.equal(await runRecapIfDue(empty, { now: sunday }), 'empty');

    config.recap.enabled = false;
    assert.equal(await runRecapIfDue(deps, { now: sunday }), 'disabled');
    assert.equal(await runRecapIfDue(deps, { now: sunday, force: true }), 'posted');
});

test('автопост: пауза и принудительный запуск', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(Math, 'random', () => 0.99);
    const store = new MemoryStore();
    const calls = [];
    const deps = {
        telegram: { sendPhoto: async () => (calls.push(1), { message_id: 1 }) },
        client: fakeClient(),
        history: new MemoryHistory(),
        config: testConfig(),
        store,
        channelStats: createChannelStats(store)
    };
    await store.set(PAUSED_KEY, true);
    assert.equal(await autopostOnce(deps), 'paused');
    assert.equal(await autopostOnce({ ...deps, force: true }), 'posted');

    deps.config.autopost.quietHours = { start: '00:00', end: '23:59' };
    deps.config.autopost.timeZone = 'UTC';
    await store.del(PAUSED_KEY);
    assert.equal(await autopostOnce({ ...deps, now: new Date('2024-01-01T12:00:00Z') }), 'quiet');
    assert.equal(await autopostOnce({ ...deps, now: new Date('2024-01-01T12:00:00Z'), force: true }), 'posted');
});

test('dtextToPlain', () => {
    const text = dtextToPlain([
        'h4. Appearance',
        '[b]Frieren[/b] is an elf from [[Sousou no Frieren]] ([[frieren|Фрирен]]).',
        '* Mage',
        'See "the site":https://example.com and {{frieren solo}}.',
        '[expand=Spoiler]secret[/expand]',
        '[table]x[/table]',
        '<https://x.y>'
    ].join('\n'));
    assert.equal(text, 'Frieren is an elf from Sousou no Frieren (Фрирен).\n• Mage\nSee the site and frieren solo.\n\n\nhttps://x.y'.replace(/\n{3,}/g, '\n\n'));
    assert.equal(dtextToPlain(''), '');
    assert.equal(dtextToPlain(null), '');

    const long = dtextToPlain(`${'Word. '.repeat(200)}`, 100);
    assert.ok(long.length <= 101);
    assert.ok(long.endsWith('…'));
    assert.ok(dtextToPlain('x'.repeat(300), 100).endsWith('…'));
});

test('enforceSafe и isAdult', () => {
    assert.deepEqual(enforceSafe('explicit', true), { rating: 'general', changed: true });
    assert.deepEqual(enforceSafe('any', true), { rating: 'general', changed: true });
    assert.deepEqual(enforceSafe('sensitive', true), { rating: 'sensitive', changed: false });
    assert.deepEqual(enforceSafe('explicit', false), { rating: 'explicit', changed: false });
    assert.equal(isAdult({ rating: 'q' }), true);
    assert.equal(isAdult({ rating: 's' }), false);
});

test('настройки и очки викторины в хранилище', async () => {
    const { settings, quiz } = createUserData(new MemoryStore());
    assert.deepEqual(await settings.get(1), { rating: 'general', count: 3, quick: false, safe: false });
    await settings.update(1, { quick: true });
    assert.equal((await settings.get(1)).quick, true);

    const user = { id: 5, first_name: 'Ann' };
    await quiz.record(user, true);
    await quiz.record(user, true);
    const after = await quiz.record(user, false);
    assert.deepEqual(after, { name: 'Ann', correct: 2, total: 3, streak: 0, best: 2 });
    await quiz.record({ id: 6, username: 'bob' }, true);
    await quiz.record({ id: 7 }, false);
    const board = await quiz.leaderboard();
    assert.deepEqual(board.map(p => [p.name, p.correct]), [['Ann', 2], ['bob', 1], ['7', 0]]);
});

test('клиент Danbooru: опечатки, вики, связанные теги', async () => {
    const calls = [];
    const client = createDanbooruClient({
        baseUrl: 'https://danbooru.donmai.us',
        userAgent: 'ua',
        fetchImpl: async (url) => {
            const u = new URL(url);
            calls.push(u);
            if (u.pathname === '/wiki_pages/missing.json') return jsonResponse({ message: 'not found' }, 404);
            if (u.pathname === '/wiki_pages/broken.json') return jsonResponse({}, 500);
            if (u.pathname.startsWith('/wiki_pages/')) return jsonResponse({ title: 'x', body: 'b' });
            if (u.pathname === '/related_tag.json') {
                return jsonResponse({ related_tags: [
                    { tag: { name: 'frieren', category: 4, post_count: 1 } },
                    { tag: { name: 'fern', category: 4, post_count: 2 } },
                    { name: 'himmel', post_count: 3 },
                    { tag: null }
                ] });
            }
            return jsonResponse([{ name: 'hatsune_miku' }]);
        }
    });

    assert.deepEqual(await client.tagsFuzzy('hatsue_miku'), [{ name: 'hatsune_miku' }]);
    assert.equal(calls[0].searchParams.get('search[fuzzy_name_matches]'), 'hatsue_miku');

    assert.deepEqual(await client.wiki('frieren'), { title: 'x', body: 'b' });
    assert.equal(await client.wiki('missing'), null);
    await assert.rejects(client.wiki('broken'), /HTTP 500/);
    assert.equal(calls.find(c => c.pathname.includes('saber')), undefined);
    await client.wiki('saber_(fate)');
    assert.equal(calls.at(-1).pathname, '/wiki_pages/saber_(fate).json');

    assert.deepEqual(await client.relatedTags('frieren'), [
        { name: 'fern', category: 4, postCount: 2 },
        { name: 'himmel', category: 0, postCount: 3 }
    ]);
    assert.equal(calls.at(-1).searchParams.get('query'), 'frieren');

    const empty = createDanbooruClient({ baseUrl: 'https://d', fetchImpl: async () => jsonResponse({}) });
    assert.deepEqual(await empty.relatedTags('x'), []);
    assert.deepEqual(await empty.tagsFuzzy('x'), []);
});

test('подсказки резолвера: транслит, фильтр пустых, ошибки', async () => {
    const seen = [];
    const client = {
        ...fakeClient(),
        tagsFuzzy: async (name) => {
            seen.push(name);
            return [{ name: 'a', post_count: 5 }, { name: 'b', post_count: 0 }, { name: 'c', post_count: 1 }, { name: 'd', post_count: 1 }, {}];
        }
    };
    const resolver = createTagResolver(client);
    assert.deepEqual((await resolver.suggest('фрирен')).map(t => t.name), ['a', 'c', 'd']);
    assert.equal(seen[0], 'friren'); // транслит; «frieren» найдут нечёткие подсказки

    const failing = createTagResolver({ ...fakeClient(), tagsFuzzy: async () => { throw new Error('x'); } });
    assert.deepEqual(await failing.suggest('x'), []);
});
