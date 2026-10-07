import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestBot, fakeClient, makePost, mockTelegram, plain } from './helpers/fakes.js';
import { decodeTagPayload, encodeTagPayload, tagLinker } from '../src/utils/tagLinks.js';
import { buildCaption } from '../src/utils/format.js';

let tg;
beforeEach(() => { tg = mockTelegram(); });
afterEach(() => tg.restore());

const keyboardOf = (payload) => (payload.reply_markup?.inline_keyboard ?? []).flat();

test('payload тега: туда и обратно, спецсимволы, лимит 64', () => {
    for (const tag of ['maid', 'saber_(fate)', ':d', 'score:>100', 'ミク']) {
        const payload = encodeTagPayload(tag, 'explicit');
        assert.match(payload, /^[A-Za-z0-9_-]{1,64}$/);
        assert.deepEqual(decodeTagPayload(payload), { tag, rating: 'explicit' });
    }
    assert.deepEqual(decodeTagPayload(encodeTagPayload('miku')), { tag: 'miku', rating: null });
    assert.equal(encodeTagPayload('x'.repeat(60), 'general'), null);
    assert.equal(decodeTagPayload('help'), null);
    assert.equal(decodeTagPayload(''), null);
});

test('подпись: с tagLink теги — ссылки на бота, без него — хэштеги', () => {
    const post = makePost({ tag_string_general: 'long_hair smile' });
    const linked = buildCaption(post, { postUrl: 'u', tagLink: tagLinker('test_bot', 'general') });
    assert.match(linked, /<a href="https:\/\/t\.me\/test_bot\?start=tg_[^"]+">Hatsune Miku<\/a>/);
    assert.match(linked, /🏷 Теги: <a href="[^"]+">long hair<\/a>, <a href="[^"]+">smile<\/a>/);
    assert.doesNotMatch(linked, /#hatsune_miku/);

    const plainCaption = buildCaption(post, { postUrl: 'u' });
    assert.match(plainCaption, /#hatsune_miku/);
    assert.equal(tagLinker(null, 'general'), null);
});

test('картинки в личке приходят с тегами-ссылками и тихо (кроме первой)', async () => {
    const t = createTestBot();
    await t.click('s:general:3', { text: '🔹 hatsune_miku (100k)\nРейтинг: 🟢 Safe' });
    await t.settle();
    const photos = tg.calls('sendPhoto');
    assert.equal(photos.length, 3);
    assert.match(photos[0].payload.caption, /t\.me\/test_bot\?start=tg_/);
    assert.equal(photos[0].payload.disable_notification, undefined);
    assert.equal(photos[1].payload.disable_notification, true);
    assert.equal(tg.calls('sendMessage').at(-1).payload.disable_notification, true);
});

test('клик по тегу: лента по тегу, «/start» удаляется, кнопка «🔀 Смешать»', async () => {
    const t = createTestBot();
    await t.userData.history.add(42, ['hatsune_miku']);
    await t.text(`/start ${encodeTagPayload('maid', 'explicit')}`);
    await t.settle();

    assert.equal(tg.calls('deleteMessage').length >= 1, true);
    const search = t.client.calls.find(([method]) => method === 'posts')[1];
    assert.ok(search.tags.includes('maid'));
    assert.ok(search.tags.includes('rating:e'));
    assert.match(tg.calls('sendPhoto')[0].payload.caption, /Лента:<\/b> maid/);

    const done = tg.calls('sendMessage').at(-1).payload;
    assert.match(done.text, /🔀 <code>hatsune_miku<\/code>/);
    const mix = keyboardOf(done).find(b => b.callback_data === 'mix:explicit');
    assert.match(mix.text, /Смешать с «hatsune_miku»/);
    assert.equal((await t.userData.history.list(42))[0][0], 'maid');

    // 🔀 → один поиск по обоим тегам
    t.client.calls.length = 0;
    await t.click('mix:explicit', { text: plain(done.text), reply_markup: done.reply_markup });
    await t.settle();
    const mixed = t.client.calls.find(([method]) => method === 'posts')[1];
    assert.ok(mixed.tags.includes('hatsune_miku') || mixed.tags.includes('maid'));
    assert.deepEqual((await t.userData.history.list(42))[0], ['hatsune_miku', 'maid']);

    // Смена рейтинга сохраняет кнопку «Смешать»
    await t.click('r:general', { text: plain(done.text), reply_markup: done.reply_markup });
    const edited = tg.calls('editMessageText').at(-1).payload;
    assert.ok(keyboardOf(edited).some(b => b.callback_data === 'mix:general'));
});

test('обычный /start и /start help по-прежнему показывают справку', async () => {
    const t = createTestBot();
    await t.text('/start help');
    assert.match(tg.calls('sendMessage').at(-1).payload.text, /Как писать запрос/);
});

test('30 картинок при включённых альбомах — 3 альбома по 10, тихо после первого', async () => {
    const client = fakeClient({ posts: async () => Array.from({ length: 40 }, () => makePost()) });
    const t = createTestBot({ client });
    await t.click('s:general:30', { text: '🔹 hatsune_miku (100k)\nРейтинг: 🟢 Safe' });
    await t.settle();
    const albums = tg.calls('sendMediaGroup');
    assert.equal(albums.length, 3);
    assert.deepEqual(albums.map(a => a.payload.media.length), [10, 10, 10]);
    assert.equal(albums[0].payload.disable_notification, undefined);
    assert.equal(albums[1].payload.disable_notification, true);
    assert.equal(tg.calls('sendPhoto').length, 0);

    // Альбомы выключены — по одной с кнопками
    tg.clear();
    await t.userData.settings.update(42, { albums: false });
    await t.click('s:general:20', { text: '🔹 hatsune_miku (100k)\nРейтинг: 🟢 Safe' });
    await t.settle();
    assert.equal(tg.calls('sendMediaGroup').length, 0);
    assert.equal(tg.calls('sendPhoto').length, 20);
});

test('гифка в пачке уходит отдельным сообщением', async () => {
    const posts = [makePost({ file_ext: 'gif', file_url: 'https://cdn.donmai.us/original/x.gif', large_file_url: 'https://cdn.donmai.us/original/x.gif' }),
        ...Array.from({ length: 12 }, () => makePost())];
    const t = createTestBot({ client: fakeClient({ posts: async () => posts }) });
    await t.click('s:general:10', { text: '🔹 hatsune_miku (100k)\nРейтинг: 🟢 Safe' });
    await t.settle();
    const inAlbums = tg.calls('sendMediaGroup').reduce((n, a) => n + a.payload.media.length, 0);
    assert.equal(inAlbums + tg.calls('sendAnimation').length, 10);
    assert.equal(tg.calls('sendAnimation').length, 1);
});
