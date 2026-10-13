import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestBot, jsonResponse, mockFetch, mockTelegram } from './helpers/fakes.js';
import { BOORUS, createBooruClient, createBooruClients, normalizeGelbooruPost, translateTags } from '../src/services/boorus.js';
import { pickMedia } from '../src/utils/posts.js';

const UA = 'test';

const gelPost = (id, extra = {}) => ({
    id, md5: `g${id}`, rating: 'general', score: 12, width: 1000, height: 1400,
    file_url: `https://img3.gelbooru.com/images/aa/bb/g${id}.jpg`,
    sample_url: `https://img3.gelbooru.com/samples/aa/bb/sample_g${id}.jpg`,
    preview_url: `https://img3.gelbooru.com/thumbnails/aa/bb/thumbnail_g${id}.jpg`,
    tags: ' 1girl hatsune_miku maid ', created_at: 'Sat Oct 05 12:00:00 -0500 2024', source: '', ...extra
});

test('translateTags: рейтинг и random в синтаксисе каждой борды', () => {
    assert.deepEqual(translateTags(['miku', 'rating:e'], BOORUS.gelbooru, { random: true }), ['miku', 'rating:explicit', 'sort:random']);
    assert.deepEqual(translateTags(['miku', '-rating:s'], BOORUS.gelbooru, { random: false }), ['miku', '-rating:sensitive']);
});

test('нормализация постов Gelbooru в формат Danbooru', () => {
    const g = normalizeGelbooruPost(gelPost(1), BOORUS.gelbooru);
    assert.equal(g.rating, 'g');
    assert.equal(g.file_ext, 'jpg');
    assert.equal(g.tag_string, '1girl hatsune_miku maid');
    assert.equal(g.created_at, '2024-10-05T17:00:00.000Z');
    assert.equal(pickMedia(g, 'https://gelbooru.com').type, 'photo');

    assert.equal(normalizeGelbooruPost(gelPost(2, { rating: 'explicit' }), BOORUS.gelbooru).rating, 'e');

});

test('клиент Gelbooru: запрос без ключа, страницы, пустой ответ, ошибка', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(new URL(url));
        if (calls.length === 2) return new Response('', { status: 200 });
        if (calls.length === 3) return new Response('busy', { status: 503 });
        return jsonResponse({ '@attributes': { count: 1 }, post: [gelPost(7)] });
    };
    const client = createBooruClient('gelbooru', { userAgent: UA, fetchImpl });
    const posts = await client.posts({ tags: ['hatsune_miku', 'rating:g'], limit: 300, random: true, page: 2 });
    assert.equal(posts[0].id, 7);
    const q = calls[0].searchParams;
    assert.equal(q.get('tags'), 'hatsune_miku rating:general sort:random');
    assert.equal(q.get('limit'), '100');
    assert.equal(q.get('pid'), '1');
    assert.equal(q.get('api_key'), null);
    assert.equal(client.postUrl(7), 'https://gelbooru.com/index.php?page=post&s=view&id=7');

    assert.deepEqual(await client.posts({ tags: ['nothing'] }), []);
    await assert.rejects(client.posts({ tags: ['x'] }), /Gelbooru: HTTP 503/);

    const keyed = createBooruClient('gelbooru', { userAgent: UA, fetchImpl, credentials: { apiKey: 'k', userId: '5' } });
    await keyed.posts({ tags: ['x'] });
    assert.equal(calls.at(-1).searchParams.get('api_key'), 'k');
    assert.equal(calls.at(-1).searchParams.get('user_id'), '5');
});

test('Gelbooru: 429 — одна повторная попытка, второй 429 — ошибка', async () => {
    let calls = 0;
    const flaky = createBooruClient('gelbooru', {
        userAgent: UA, retryDelayMs: 0,
        fetchImpl: async () => (++calls === 1 ? new Response('slow down', { status: 429 }) : jsonResponse({ post: [gelPost(5)] }))
    });
    assert.equal((await flaky.posts({ tags: ['x'] }))[0].id, 5);
    assert.equal(calls, 2);

    const limited = createBooruClient('gelbooru', { userAgent: UA, retryDelayMs: 0, fetchImpl: async () => new Response('', { status: 429 }) });
    await assert.rejects(limited.posts({ tags: ['x'] }), /Gelbooru: HTTP 429/);
});

test('источники: Danbooru (основной) и Gelbooru', () => {
    const clients = createBooruClients({ baseUrl: 'x' }, { userAgent: UA });
    assert.deepEqual(Object.keys(clients), ['danbooru', 'gelbooru']);
    assert.equal(clients.danbooru.name, 'Danbooru');
});

// ---------- В боте ----------

let tg;
let net;
beforeEach(() => { tg = mockTelegram(); });
afterEach(() => { tg.restore(); net?.restore(); net = null; });

test('/settings → источник Gelbooru: поиск идёт туда, кнопки — ссылки, подпись с Gelbooru', async () => {
    net = mockFetch(async () => jsonResponse({ post: [gelPost(101), gelPost(102), gelPost(103)] }));
    const boorus = { gelbooru: createBooruClient('gelbooru', { userAgent: UA }) };
    const t = createTestBot({ boorus });

    await t.text('/settings');
    const shown = tg.calls('sendMessage').at(-1).payload;
    assert.ok(shown.reply_markup.inline_keyboard.flat().some(b => b.callback_data === 'set:source:gelbooru'));
    await t.click('set:source:gelbooru');
    assert.equal((await t.userData.settings.get(42)).source, 'gelbooru');
    assert.match(tg.calls('editMessageText').at(-1).payload.text, /Источник: <b>Gelbooru/);

    await t.click('s:general:3', { text: '🔹 hatsune_miku (100k)\nРейтинг: 🟢 Safe' });
    await t.settle();
    assert.ok(net.calls.every(c => c.url.startsWith('https://gelbooru.com/index.php')));
    assert.ok(!t.client.calls.some(([m]) => m === 'posts'));
    const photos = tg.calls('sendPhoto');
    assert.equal(photos.length, 3);
    assert.match(photos[0].payload.caption, /Открыть на Gelbooru/);
    const buttons = photos[0].payload.reply_markup.inline_keyboard.flat();
    assert.ok(buttons.every(b => b.url));
    assert.ok(buttons.some(b => b.url === 'https://gelbooru.com/index.php?page=post&s=view&id=101'));
    assert.match(tg.calls('sendMessage').find(m => /Ищу/.test(m.payload.text)).payload.text, /на Gelbooru/);
});

test('борда не пускает бота (HTTP 403) → предупреждение и поиск на Danbooru', async () => {
    net = mockFetch(async () => new Response('Forbidden', { status: 403 }));
    const boorus = { gelbooru: createBooruClient('gelbooru', { userAgent: UA }) };
    const t = createTestBot({ boorus });
    await t.userData.settings.update(42, { source: 'gelbooru' });

    await t.click('s:general:3', { text: '🔹 hatsune_miku (100k)\nРейтинг: 🟢 Safe' });
    await t.settle();
    assert.ok(tg.calls('sendMessage').some(m => /Gelbooru сейчас не пускает бота \(Gelbooru: HTTP 403\) — ищу на Danbooru/.test(m.payload.text)));
    assert.ok(t.client.calls.some(([m]) => m === 'posts'));
    assert.equal(tg.calls('sendPhoto').length, 3);
    assert.match(tg.calls('sendPhoto')[0].payload.caption, /Открыть на Danbooru/);
});

test('на другой борде пусто → добирает с Danbooru', async () => {
    net = mockFetch(async () => jsonResponse([]));
    const boorus = { gelbooru: createBooruClient('gelbooru', { userAgent: UA }) };
    const t = createTestBot({ boorus });
    await t.userData.settings.update(42, { source: 'gelbooru' });

    await t.click('s:general:3', { text: '🔹 hatsune_miku (100k)\nРейтинг: 🟢 Safe' });
    await t.settle();
    assert.ok(tg.calls('sendMessage').some(m => /На Gelbooru по <code>hatsune_miku<\/code> ничего — ищу на Danbooru/.test(m.payload.text)));
    assert.equal(tg.calls('sendPhoto').length, 3);
    assert.match(tg.calls('sendPhoto')[0].payload.caption, /Открыть на Danbooru/);
});

test('на другой борде неизвестный Danbooru тег уходит в поиск как есть', async () => {
    net = mockFetch(async () => jsonResponse({ post: [gelPost(201)] }));
    const boorus = { gelbooru: createBooruClient('gelbooru', { userAgent: UA }) };
    const t = createTestBot({ boorus });
    await t.userData.settings.update(42, { source: 'gelbooru' });
    await t.text('some western character');
    const edit = tg.calls('editMessageText').at(-1).payload;
    assert.match(edit.text, /some_western_character/);
    assert.doesNotMatch(edit.text, /Не нашёл/);
});

test('недоступная борда в настройках — поиск откатывается на Danbooru', async () => {
    const t = createTestBot({ boorus: {} });
    await t.userData.settings.update(42, { source: 'sankaku' });
    await t.click('s:general:1', { text: '🔹 hatsune_miku (100k)\nРейтинг: 🟢 Safe' });
    await t.settle();
    assert.ok(t.client.calls.some(([m]) => m === 'posts'));
    assert.match(tg.calls('sendPhoto')[0].payload.caption, /Открыть на Danbooru/);
});
