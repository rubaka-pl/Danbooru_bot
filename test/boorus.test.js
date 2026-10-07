import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestBot, jsonResponse, mockFetch, mockTelegram } from './helpers/fakes.js';
import { BOORUS, createBooruClient, createBooruClients, normalizeGelbooruPost, normalizeMoebooruPost, translateTags } from '../src/services/boorus.js';
import { pickMedia } from '../src/utils/posts.js';

const UA = 'test';

const gelPost = (id, extra = {}) => ({
    id, md5: `g${id}`, rating: 'general', score: 12, width: 1000, height: 1400,
    file_url: `https://img3.gelbooru.com/images/aa/bb/g${id}.jpg`,
    sample_url: `https://img3.gelbooru.com/samples/aa/bb/sample_g${id}.jpg`,
    preview_url: `https://img3.gelbooru.com/thumbnails/aa/bb/thumbnail_g${id}.jpg`,
    tags: ' 1girl hatsune_miku maid ', created_at: 'Sat Oct 05 12:00:00 -0500 2024', source: '', ...extra
});

const moePost = (id, extra = {}) => ({
    id, md5: `k${id}`, rating: 's', score: 50, width: 1920, height: 1080, file_size: 3_000_000, file_ext: 'png',
    file_url: `https://konachan.com/image/k${id}.png`, jpeg_url: `https://konachan.com/jpeg/k${id}.jpg`,
    sample_url: `https://konachan.com/sample/k${id}.jpg`, preview_url: `https://konachan.com/preview/k${id}.jpg`,
    tags: 'hatsune_miku vocaloid', created_at: 1_700_000_000, source: '', ...extra
});

test('translateTags: рейтинг и random в синтаксисе каждой борды', () => {
    assert.deepEqual(translateTags(['miku', 'rating:e'], BOORUS.gelbooru, { random: true }), ['miku', 'rating:explicit', 'sort:random']);
    assert.deepEqual(translateTags(['miku', 'rating:g'], BOORUS.konachan, { random: true }), ['miku', 'rating:s', 'order:random']);
    assert.deepEqual(translateTags(['miku', 'rating:s'], BOORUS.yandere, { random: false }), ['miku', 'rating:q']);
});

test('нормализация постов Gelbooru / Moebooru в формат Danbooru', () => {
    const g = normalizeGelbooruPost(gelPost(1), BOORUS.gelbooru);
    assert.equal(g.rating, 'g');
    assert.equal(g.file_ext, 'jpg');
    assert.equal(g.tag_string, '1girl hatsune_miku maid');
    assert.equal(g.created_at, '2024-10-05T17:00:00.000Z');
    assert.equal(pickMedia(g, 'https://gelbooru.com').type, 'photo');

    assert.equal(normalizeGelbooruPost(gelPost(2, { rating: 'explicit' }), BOORUS.gelbooru).rating, 'e');

    const k = normalizeMoebooruPost(moePost(2, { rating: 'e' }), BOORUS.konachan);
    assert.equal(k.rating, 'e');
    assert.equal(k.large_file_url, 'https://konachan.com/sample/k2.jpg');
    assert.equal(normalizeMoebooruPost(moePost(3, { rating: 'q' }), BOORUS.yandere).rating, 'q');
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
});

test('клиент Konachan: post.json и пост по id', async () => {
    const urls = [];
    const client = createBooruClient('konachan', {
        userAgent: UA,
        fetchImpl: async (url) => { urls.push(new URL(url)); return jsonResponse([moePost(9)]); }
    });
    await client.posts({ tags: ['miku', 'rating:e'], random: true, limit: 20 });
    assert.equal(urls[0].pathname, '/post.json');
    assert.equal(urls[0].searchParams.get('tags'), 'miku rating:e order:random');
    assert.equal((await client.post(9)).id, 9);
    assert.equal(urls[1].searchParams.get('tags'), 'id:9');
    assert.equal(client.postUrl(9), 'https://konachan.com/post/show/9');
});

test('источники: Danbooru (основной), Gelbooru, Konachan, Yande.re', () => {
    const clients = createBooruClients({ baseUrl: 'x' }, { userAgent: UA });
    assert.deepEqual(Object.keys(clients), ['danbooru', 'gelbooru', 'konachan', 'yandere']);
    assert.equal(clients.danbooru.name, 'Danbooru');
});

// ---------- В боте ----------

let tg;
let net;
beforeEach(() => { tg = mockTelegram(); });
afterEach(() => { tg.restore(); net?.restore(); net = null; });

test('/settings → источник Konachan: поиск идёт туда, кнопки — ссылки, подпись с Konachan', async () => {
    net = mockFetch(async () => jsonResponse([moePost(101), moePost(102), moePost(103)]));
    const boorus = { konachan: createBooruClient('konachan', { userAgent: UA }) };
    const t = createTestBot({ boorus });

    await t.text('/settings');
    const shown = tg.calls('sendMessage').at(-1).payload;
    assert.ok(shown.reply_markup.inline_keyboard.flat().some(b => b.callback_data === 'set:source:konachan'));
    await t.click('set:source:konachan');
    assert.equal((await t.userData.settings.get(42)).source, 'konachan');
    assert.match(tg.calls('editMessageText').at(-1).payload.text, /Источник: <b>Konachan/);

    await t.click('s:general:3', { text: '🔹 hatsune_miku (100k)\nРейтинг: 🟢 Safe' });
    await t.settle();
    assert.ok(net.calls.every(c => c.url.startsWith('https://konachan.com/post.json')));
    assert.ok(!t.client.calls.some(([m]) => m === 'posts'));
    const photos = tg.calls('sendPhoto');
    assert.equal(photos.length, 3);
    assert.match(photos[0].payload.caption, /Открыть на Konachan/);
    const buttons = photos[0].payload.reply_markup.inline_keyboard.flat();
    assert.ok(buttons.every(b => b.url));
    assert.ok(buttons.some(b => b.url === 'https://konachan.com/post/show/101'));
    assert.match(tg.calls('sendMessage').find(m => /Ищу/.test(m.payload.text)).payload.text, /на Konachan/);
});

test('на другой борде неизвестный Danbooru тег уходит в поиск как есть', async () => {
    net = mockFetch(async () => jsonResponse([moePost(201)]));
    const boorus = { konachan: createBooruClient('konachan', { userAgent: UA }) };
    const t = createTestBot({ boorus });
    await t.userData.settings.update(42, { source: 'konachan' });
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
