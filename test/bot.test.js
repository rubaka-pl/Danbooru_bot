import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestBot, fakeClient, makePost, mockTelegram, mockFetch, plain, testConfig } from './helpers/fakes.js';

let tg;
beforeEach(() => { tg = mockTelegram(); });
afterEach(() => tg.restore());

const lastText = (method = 'sendMessage') => tg.calls(method).at(-1)?.payload.text;

test('/start и /help показывают справку, кнопка 18+ тегов работает', async () => {
    const t = createTestBot();
    await t.text('/start');
    await t.text('/help');
    assert.equal(tg.calls('sendMessage').length, 2);
    assert.match(lastText(), /Как писать запрос/);

    await t.click('show_tags');
    assert.match(lastText(), /18\+ теги/);
    await t.text('/tags');
    assert.match(lastText(), /<code>anal<\/code>/);
});

test('текст → подтверждение с разобранными тегами и кнопками', async () => {
    const t = createTestBot();
    await t.text('hatsune miku, swimsuit');
    const edit = tg.calls('editMessageText').at(-1).payload;
    assert.match(edit.text, /hatsune_miku<\/code> \(100k\) \+ <code>swimsuit<\/code> \(300k\)/);
    assert.match(edit.text, /Рейтинг: 🟢 Safe/);
    const buttons = edit.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
    assert.ok(buttons.includes('s:general:3'));
    assert.ok(buttons.includes('r:explicit'));
});

test('ненайденные теги показываются, если ничего не найдено — подсказка', async () => {
    const t = createTestBot();
    await t.text('абракадабра');
    const edit = tg.calls('editMessageText').at(-1).payload;
    assert.match(edit.text, /Не нашёл/);
    assert.equal(edit.reply_markup, undefined);
});

test('NSFW-тег сам включает 18+, ключевое слово тоже', async () => {
    const client = fakeClient({ tagByName: async (name) => ({ name, post_count: 10 }) });
    const t = createTestBot({ client });
    await t.text('nude');
    assert.match(tg.calls('editMessageText').at(-1).payload.text, /🔴 18\+/);
    await t.text('miku safe');
    assert.match(tg.calls('editMessageText').at(-1).payload.text, /🟢 Safe/);
});

test('только рейтинг без тегов и неизвестная команда', async () => {
    const t = createTestBot();
    await t.text('nsfw');
    assert.match(lastText(), /А что искать/);
    await t.text('/nope');
    assert.match(lastText(), /Не знаю такую команду/);
});

test('ошибка Danbooru при разборе запроса показывается пользователю', async () => {
    const client = fakeClient({
        tagByName: async () => { const e = new Error('slow down'); e.isRateLimit = true; throw e; }
    });
    const t = createTestBot({ client });
    await t.text('miku');
    assert.match(tg.calls('editMessageText').at(-1).payload.text, /Danbooru просит подождать/);
});

test('переключение рейтинга сохраняет запрос и кнопку подписки', async () => {
    const t = createTestBot();
    const text = '✅ Готово! Хочешь ещё?\n🔹 hatsune_miku (100k)\nРейтинг: 🟢 Safe';
    await t.click('r:explicit', { text, reply_markup: { inline_keyboard: [[{ text: 'x', callback_data: 'sub:general' }]] } });
    const edit = tg.calls('editMessageText').at(-1).payload;
    assert.match(edit.text, /hatsune_miku<\/code> \(100k\)/);
    assert.match(edit.text, /Рейтинг: 🔴 18\+/);
    const data = edit.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
    assert.ok(data.includes('sub:explicit'));
    assert.ok(data.includes('s:explicit:5'));

    tg.clear();
    await t.click('r:bogus', { text });
    assert.deepEqual(tg.methods(), ['answerCallbackQuery']);
});

test('кнопка поиска присылает картинки с кнопками и итоговое сообщение', async () => {
    const t = createTestBot();
    await t.click('s:general:3', { text: '🔎 Понял так:\n🔹 hatsune_miku (100k) + swimsuit (300k)\nРейтинг: 🟢 Safe' });
    await t.settle();

    const photos = tg.calls('sendPhoto');
    assert.equal(photos.length, 3);
    const buttons = photos[0].payload.reply_markup.inline_keyboard.flat().map(b => b.callback_data).filter(Boolean);
    assert.ok(buttons.some(d => d.startsWith('f:')));
    assert.ok(buttons.some(d => d.startsWith('sim:')));
    assert.ok(buttons.some(d => d.startsWith('art:')));
    assert.ok(buttons.some(d => d.startsWith('chr:')));
    assert.ok(photos[0].payload.photo.includes('/original/')); // полное качество
    assert.ok(photos[0].payload.reply_markup.inline_keyboard.flat().some(b => b.text === '🖼 View original' && b.url.includes('/original/')));

    const posts = t.client.calls.filter(c => c[0] === 'posts');
    // random: занимает слот — на сервер уходит 1 тег, второй фильтруется ботом
    assert.deepEqual(posts[0][1].tags, ['hatsune_miku', 'rating:g']);

    assert.match(lastText(), /Готово/);
    assert.ok(tg.calls('deleteMessage').length >= 1);
});

test('поиск: мало результатов — сообщает, ничего — предлагает другой рейтинг', async () => {
    let n = 0;
    const client = fakeClient({ posts: async () => (n++ === 0 ? [makePost()] : []) });
    const t = createTestBot({ client });
    await t.click('s:general:3', { text: '🔹 hatsune_miku\nРейтинг: x' });
    await t.settle();
    assert.ok(tg.calls('sendMessage').some(c => /нашлось только 1 из 3/.test(c.payload.text)));

    await t.click('s:general:3', { text: '🔹 hatsune_miku\nРейтинг: x' });
    await t.settle();
    assert.ok(tg.calls('sendMessage').some(c => /ничего нового не нашлось/.test(c.payload.text)));
});

test('поиск: устаревшее сообщение и ошибка API', async () => {
    const client = fakeClient({ posts: async () => { throw new Error('boom'); } });
    const t = createTestBot({ client });
    await t.click('s:general:3', { text: 'пусто' });
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /устарел/);

    await t.click('s:general:1', { text: '🔹 hatsune_miku' });
    await t.settle();
    assert.ok(tg.calls('sendMessage').some(c => /Ошибка: boom/.test(c.payload.text)));
});

test('пока идёт поиск, второй запрос получает «подожди»', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const client = fakeClient({ posts: async () => { await gate; return [makePost()]; } });
    const t = createTestBot({ client });
    await t.click('s:general:1', { text: '🔹 hatsune_miku' });
    await t.click('s:general:1', { text: '🔹 hatsune_miku' });
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /Подожди/);
    await t.text('/random');
    assert.match(lastText(), /Подожди/);
    release();
    await t.settle();
});

test('если Telegram не принял оригинал — шлёт копию, а если и её нет — загружает файл сам', async () => {
    tg.restore();
    let rejects = 1;
    tg = mockTelegram((method, payload) => {
        if (method === 'sendPhoto' && typeof payload.photo === 'string' && rejects-- > 0) {
            throw new Error('wrong file identifier/HTTP URL specified');
        }
        return undefined;
    });
    const fetchMock = mockFetch(async () => new Response(new Uint8Array([1, 2, 3])));
    try {
        const t = createTestBot();
        await t.click('s:general:1', { text: '🔹 hatsune_miku' });
        await t.settle();
        const photos = tg.calls('sendPhoto').map(c => c.payload.photo);
        assert.match(photos[0], /\/original\//);
        assert.match(photos[1], /\/sample\//);
        assert.equal(fetchMock.calls.length, 0);

        // Обе ссылки не приняты — загрузка файлом
        rejects = 2;
        tg.clear();
        await t.click('s:general:1', { text: '🔹 hatsune_miku' });
        await t.settle();
        assert.equal(fetchMock.calls.length, 1);
        assert.match(fetchMock.calls[0].url, /\/sample\//);
        assert.equal(tg.calls('sendPhoto').length, 3);
    } finally {
        fetchMock.restore();
    }
});

test('/random и /top', async () => {
    const t = createTestBot();
    await t.text('/random nsfw');
    await t.settle();
    const call = t.client.calls.find(c => c[0] === 'posts');
    assert.deepEqual(call[1].tags, ['score:>20', 'rating:e']);
    assert.equal(tg.calls('sendPhoto').length, 1);

    tg.clear();
    await t.text('/top week');
    await t.settle();
    assert.deepEqual(t.client.calls.find(c => c[0] === 'popular')[1], { scale: 'week' });
    assert.equal(tg.calls('sendPhoto').length, 2); // только rating:g

    const empty = createTestBot({ client: fakeClient({ popular: async () => [] }) });
    await empty.text('/top month nsfw');
    await empty.settle();
    assert.match(lastText(), /Ничего нового в топе/);
});

test('❤️ избранное: добавить, убрать, /favs с альбомом и удаление', async () => {
    const t = createTestBot();
    await t.click('f:10');
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /Добавлено/);
    await t.click('f:11');
    await t.click('f:12');
    await t.click('f:12');
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /Убрано/);
    assert.deepEqual(await t.userData.favorites.list(42), [11, 10]);

    await t.text('/favs');
    await t.settle();
    assert.equal(tg.calls('sendMediaGroup').length, 1);
    assert.equal(tg.calls('sendMediaGroup')[0].payload.media.length, 2);
    const nav = tg.calls('sendMessage').at(-1).payload;
    assert.match(nav.text, /Избранное.*стр\. 1\/1/);

    await t.click('fd:11', { reply_markup: nav.reply_markup });
    assert.deepEqual(await t.userData.favorites.list(42), [10]);
    const edited = tg.calls('editMessageReplyMarkup').at(-1).payload.reply_markup.inline_keyboard.flat();
    assert.ok(!edited.some(b => b.callback_data === 'fd:11'));
});

test('/favs: пусто, одна картинка и страницы', async () => {
    const t = createTestBot();
    await t.text('/favs');
    await t.settle();
    assert.match(lastText(), /Избранное пустое/);

    for (let id = 1; id <= 12; id++) await t.userData.favorites.toggle(42, id);
    tg.clear();
    await t.click('fp:1');
    await t.settle();
    assert.match(lastText(), /стр\. 2\/2/);
    assert.equal(tg.calls('sendMediaGroup')[0].payload.media.length, 2);
    const nav = tg.calls('sendMessage').at(-1).payload.reply_markup.inline_keyboard.flat();
    assert.ok(nav.some(b => b.callback_data === 'fp:0'));
});

test('🎨 ещё автора / 👤 ещё персонажа', async () => {
    const client = fakeClient({ post: async (id) => makePost({ id, rating: 'e', tag_string_artist: 'cool_artist' }) });
    const t = createTestBot({ client });
    await t.click('art:5');
    await t.settle();
    const search = t.client.calls.find(c => c[0] === 'posts');
    assert.deepEqual(search[1].tags, ['cool_artist', 'rating:e']);
    assert.ok(tg.calls('sendPhoto').length > 0);

    const noChar = createTestBot({ client: fakeClient({ post: async (id) => makePost({ id, tag_string_character: '' }) }) });
    await noChar.click('chr:5');
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /нет тега/);

    const broken = createTestBot({ client: fakeClient({ post: async () => { throw new Error('404'); } }) });
    await broken.click('art:5');
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /404/);
});

test('🔍 похожие: исключает сам пост и дотягивает недостающие', async () => {
    const t = createTestBot();
    await t.click('sim:5');
    await t.settle();
    assert.ok(t.client.calls.some(c => c[0] === 'postsByIds' && c[1][0] === 77));
    const photos = tg.calls('sendPhoto');
    assert.equal(photos.length, 1);
    assert.match(photos[0].payload.caption, /Похожее/);

    const none = createTestBot({ client: fakeClient({ similarToPost: async () => [] }) });
    await none.click('sim:5');
    await none.settle();
    assert.match(lastText(), /Похожих картинок не нашлось/);
});

test('блок-лист: /block, /blocklist, скрытие в поиске, /unblock и кнопка', async () => {
    const t = createTestBot();
    await t.text('/block');
    assert.match(lastText(), /какие теги скрывать/);

    await t.text('/block male focus, неизвестное_что_то');
    assert.match(lastText(), /Заблокировано: <code>male_focus/);
    assert.match(lastText(), /Не нашёл тег/);
    await t.text('/block male_focus');
    assert.match(lastText(), /уже в блок-листе/);

    await t.text('/blocklist');
    assert.match(lastText(), /1\. <code>male_focus/);

    // Поиск пропускает посты с заблокированным тегом
    tg.clear();
    const client = t.client;
    client.posts = async () => [makePost({ tag_string: 'hatsune_miku male_focus' }), makePost()];
    await t.click('s:general:3', { text: '🔹 hatsune_miku' });
    await t.settle();
    assert.equal(tg.calls('sendPhoto').length, 1);

    await t.text('/unblock nothing_here');
    assert.match(lastText(), /нет в блок-листе/);
    await t.text('/unblock');
    assert.match(lastText(), /Блок-лист/);
    await t.click('ub:0');
    assert.deepEqual(await t.userData.blocklist.list(42), []);
    assert.match(tg.calls('editMessageText').at(-1).payload.text, /Блок-лист пуст/);
    await t.click('ub:0');
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /Уже удалено/);

    await t.text('/unblock male_focus');
});

test('подписки: /sub, повтор, /subs, проверить сейчас, отписка', async () => {
    const t = createTestBot();
    await t.text('/sub');
    assert.match(lastText(), /на что подписаться/);
    await t.text('/sub неизвестное_что_то');
    assert.match(lastText(), /Не нашёл/);

    await t.text('/sub hatsune miku');
    assert.match(lastText(), /Подписка на <code>hatsune_miku<\/code>/);
    await t.text('/sub hatsune miku');
    assert.match(lastText(), /уже подписан/);

    const [sub] = await t.userData.subscriptions.list(42);
    assert.ok(sub.lastId > 0);
    assert.deepEqual(await t.userData.subscriptions.chats(), [42]);

    await t.text('/subs');
    assert.match(lastText(), /1\. <code>hatsune_miku/);

    // Новые посты с id больше lastId
    t.client.posts = async () => [makePost({ id: sub.lastId + 1 }), makePost({ id: sub.lastId + 2 })];
    tg.clear();
    await t.click('subnow');
    await t.settle();
    assert.equal(tg.calls('sendMediaGroup').length, 1);
    assert.match(tg.calls('sendMediaGroup')[0].payload.media[0].caption, /Подписка/);

    tg.clear();
    await t.click('subnow');
    await t.settle();
    assert.match(lastText(), /ничего нового/);

    await t.click('us:0');
    assert.deepEqual(await t.userData.subscriptions.list(42), []);
    assert.match(tg.calls('editMessageText').at(-1).payload.text, /Подписок нет/);
});

test('подписка кнопкой после поиска', async () => {
    const t = createTestBot();
    await t.click('sub:sensitive', { text: '✅ Готово!\n🔹 hatsune_miku (100k)\n🔹 swimsuit (300k)' });
    const subs = await t.userData.subscriptions.list(42);
    assert.deepEqual(subs.map(s => [s.tags[0], s.rating]), [['hatsune_miku', 'sensitive'], ['swimsuit', 'sensitive']]);

    await t.click('sub:general', { text: 'нет запроса' });
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /устарел/);
});

test('лимит подписок — 10', async () => {
    const t = createTestBot({ client: fakeClient({ tagByName: async (name) => ({ name, post_count: 5 }) }) });
    for (let i = 0; i < 10; i++) await t.text(`/sub tag${i}`);
    await t.text('/sub tag_extra');
    assert.match(lastText(), /Максимум 10 подписок/);
});

test('поиск по картинке: фото и документ', async () => {
    const fetchMock = mockFetch(async () => new Response(new Uint8Array([1, 2, 3])));
    try {
        const t = createTestBot();
        await t.message({ photo: [{ file_id: 'small', width: 90, height: 90 }, { file_id: 'big', width: 900, height: 900 }] });
        await t.settle();
        assert.equal(tg.calls('getFile')[0].payload.file_id, 'big');
        const photo = tg.calls('sendPhoto').at(-1).payload;
        assert.match(photo.caption, /Нашёл! Сходство 95%/);
        assert.match(photo.caption, /Оригинал/);

        tg.clear();
        await t.message({ document: { file_id: 'doc', mime_type: 'image/png', file_size: 1000, file_name: 'a.png' } });
        await t.settle();
        assert.equal(tg.calls('getFile').length, 1);

        tg.clear();
        await t.message({ document: { file_id: 'doc', mime_type: 'image/png', file_size: 30 * 1024 * 1024 } });
        assert.match(lastText(), /больше 20 МБ/);

        tg.clear();
        await t.message({ document: { file_id: 'doc', mime_type: 'application/zip', file_size: 10 } });
        assert.deepEqual(tg.methods(), []);
    } finally {
        fetchMock.restore();
    }
});

test('поиск по картинке: ничего не найдено и другие совпадения', async () => {
    const fetchMock = mockFetch(async (url) => (url.includes('iqdb.org')
        ? new Response('<html></html>')
        : new Response(new Uint8Array([1]))));
    try {
        const none = createTestBot({ client: fakeClient({ similarToFile: async () => [] }) });
        await none.message({ photo: [{ file_id: 'x', width: 1, height: 1 }] });
        await none.settle();
        assert.match(lastText(), /не нашёл/);

        tg.clear();
        const many = createTestBot({
            client: fakeClient({
                similarToFile: async () => [
                    { postId: 1, score: 60, post: makePost({ id: 1, source: '' }) },
                    { postId: 2, score: 55, post: makePost({ id: 2 }) }
                ]
            })
        });
        await many.message({ photo: [{ file_id: 'x', width: 1, height: 1 }] });
        await many.settle();
        assert.match(tg.calls('sendPhoto')[0].payload.caption, /Возможно, это оно/);
        assert.match(lastText(), /Другие совпадения/);
    } finally {
        fetchMock.restore();
    }
});

test('в группах бот не реагирует на обычный текст и фото', async () => {
    const t = createTestBot();
    const group = { id: -100, type: 'group', title: 'g' };
    await t.update({ message: { message_id: 1, date: 0, chat: group, from: t.user, text: 'miku' } });
    await t.update({ message: { message_id: 2, date: 0, chat: group, from: t.user, photo: [{ file_id: 'x', width: 1, height: 1 }] } });
    assert.deepEqual(tg.methods(), []);
});

test('inline-режим: поиск, пагинация, пустой запрос, ничего не найдено', async () => {
    const seen = [];
    const client = fakeClient({
        posts: async (params) => seen.push(params) && [
            makePost(),
            makePost({ file_ext: 'gif', file_url: 'https://cdn/x.gif' }),
            makePost({ file_ext: 'png', large_file_url: 'https://cdn/x.png', file_url: 'https://cdn/x.png' })
        ]
    });
    const t = createTestBot({ client });
    await t.inline('miku nsfw', '2');
    const answer = tg.calls('answerInlineQuery').at(-1).payload;
    assert.deepEqual(answer.results.map(r => r.type), ['photo', 'gif']);
    assert.equal(answer.next_offset, '3');
    assert.equal(seen[0].page, 2);
    assert.equal(seen[0].random, false);
    assert.ok(seen[0].tags.includes('rating:e'));

    await t.inline('');
    const popular = tg.calls('answerInlineQuery').at(-1).payload;
    assert.equal(popular.results.length, 2);
    assert.equal(popular.next_offset, '');

    await t.inline('абракадабра');
    const empty = tg.calls('answerInlineQuery').at(-1).payload;
    assert.equal(empty.results.length, 0);
    assert.equal(empty.button.start_parameter, 'help');
});

test('inline: ошибка API не роняет бота, блок-лист делает ответ личным', async () => {
    const client = fakeClient({ popular: async () => { throw new Error('down'); } });
    const t = createTestBot({ client });
    await t.userData.blocklist.add(42, ['vocaloid']);
    await t.inline('');
    const answer = tg.calls('answerInlineQuery').at(-1).payload;
    assert.equal(answer.results.length, 0);
    assert.equal(answer.is_personal, true);
});

test('реакции в канале → статистика → /stats', async () => {
    const t = createTestBot();
    await t.text('/stats');
    assert.match(lastText(), /Статистики пока нет/);

    await t.channelStats.recordPost(1, makePost({ tag_string_character: 'rem_(re:zero)' }));
    await t.channelStats.recordPost(2, makePost({ tag_string_character: 'rem_(re:zero)' }));
    await t.update({
        message_reaction_count: {
            chat: { id: -1001, type: 'channel', title: 'c' }, message_id: 1, date: 0,
            reactions: [{ type: { type: 'emoji', emoji: '👍' }, total_count: 5 }, { type: { type: 'emoji', emoji: '🔥' }, total_count: 2 }]
        }
    });
    const [top] = await t.channelStats.top(1);
    assert.equal(top.tag, 'rem_(re:zero)');
    assert.equal(top.reactions, 7);

    await t.text('/stats');
    assert.match(lastText(), /Rem \(Re:zero\) — 3\.5 · 2/);
});

test('/stats только для админов, если ADMIN_IDS задан', async () => {
    const t = createTestBot({ config: testConfig({ adminIds: [1] }) });
    await t.text('/stats');
    assert.match(lastText(), /только администраторам/);
});

test('Telegram просит подождать (429) — бот ждёт и повторяет', async (t) => {
    tg.restore();
    let first = true;
    tg = mockTelegram((method) => {
        if (method === 'sendPhoto' && first) {
            first = false;
            const error = Object.assign(new Error('Too Many Requests'), { response: { error_code: 429, parameters: { retry_after: 0 } } });
            throw error;
        }
        return undefined;
    });
    const t2 = createTestBot();
    await t2.click('s:general:1', { text: '🔹 hatsune_miku' });
    await t2.settle();
    assert.equal(tg.calls('sendPhoto').length, 2);
});

test('/favs: gif отправляется отдельно от альбома', async () => {
    const client = fakeClient({ postsByIds: async (ids) => ids.map(id => makePost({ id, file_ext: id === 1 ? 'gif' : 'jpg', file_url: `https://x/${id}.gif` })) });
    const t = createTestBot({ client });
    for (const id of [1, 2, 3]) await t.userData.favorites.toggle(42, id);
    await t.text('/favs');
    await t.settle();
    assert.equal(tg.calls('sendAnimation').length, 1);
    assert.equal(tg.calls('sendMediaGroup')[0].payload.media.length, 2);
});

test('кнопки под картинкой, пока идёт другая задача, отвечают «подожди»', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const client = fakeClient({ posts: async () => { await gate; return []; } });
    const t = createTestBot({ client });
    await t.click('s:general:1', { text: '🔹 hatsune_miku' });
    await t.click('art:5');
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /Подожди/);
    await t.click('sim:5');
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /Подожди/);
    await t.text('/favs');
    assert.match(lastText(), /Подожди/);
    await t.message({ photo: [{ file_id: 'x', width: 1, height: 1 }] });
    assert.match(lastText(), /Подожди/);
    release();
    await t.settle();
});

test('поиск по картинке: если картинку не удалось отправить — ссылка текстом', async () => {
    tg.restore();
    tg = mockTelegram((method) => { if (method === 'sendPhoto') throw new Error('bad'); return undefined; });
    const fetchMock = mockFetch(async (url) => (url.includes('api.telegram.org') ? new Response(new Uint8Array([1])) : new Response('no', { status: 404 })));
    try {
        const t = createTestBot();
        await t.message({ photo: [{ file_id: 'x', width: 1, height: 1 }] });
        await t.settle();
        assert.ok(tg.calls('sendMessage').some(c => /posts\/55 \(сходство 95%\)/.test(c.payload.text)));
    } finally {
        fetchMock.restore();
    }
});

test('поиск по картинке: не удалось скачать файл из Telegram', async () => {
    const fetchMock = mockFetch(async () => new Response('no', { status: 500 }));
    try {
        const t = createTestBot();
        await t.message({ photo: [{ file_id: 'x', width: 1, height: 1 }] });
        await t.settle();
        assert.match(lastText(), /не удалось скачать картинку/);
    } finally {
        fetchMock.restore();
    }
});

test('ошибка при сохранении реакций не роняет бота', async (t) => {
    t.mock.method(console, 'error', () => {});
    const bot = createTestBot();
    bot.channelStats.updateReactions = async () => { throw new Error('store down'); };
    await bot.update({ message_reaction_count: { chat: { id: -1, type: 'channel', title: 'c' }, message_id: 1, date: 0, reactions: [] } });
    assert.match(console.error.mock.calls.at(-1).arguments[1], /store down/);
});

test('необработанная ошибка в обработчике логируется, бот не падает', async (t) => {
    t.mock.method(console, 'error', () => {});
    const bot = createTestBot();
    bot.userData.favorites.toggle = async () => { throw new Error('kaput'); };
    await bot.click('f:1');
    assert.match(String(console.error.mock.calls.at(-1).arguments[0]), /Ошибка в обработчике \(callback_query\)/);
});
