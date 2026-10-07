import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestBot, fakeClient, makePost, mockTelegram, mockFetch, testConfig } from './helpers/fakes.js';
import { buildQuestion, shuffle, FALLBACK_CHARACTERS } from '../src/bot/handlers/quiz.js';
import { favoriteTags, pickWeighted } from '../src/bot/handlers/forYou.js';
import { settingsView } from '../src/bot/handlers/settings.js';
import { PAUSED_KEY } from '../src/services/autopost.js';

let tg;
beforeEach(() => { tg = mockTelegram(); });
afterEach(() => tg.restore());

const lastText = (method = 'sendMessage') => tg.calls(method).at(-1)?.payload.text;
const buttons = (payload) => (payload.reply_markup?.inline_keyboard ?? []).flat().map(b => b.callback_data);

// ---------- Настройки ----------

test('/settings: показ и переключение всех настроек', async () => {
    const t = createTestBot();
    await t.text('/settings');
    const shown = tg.calls('sendMessage').at(-1).payload;
    assert.match(shown.text, /Рейтинг по умолчанию: 🟢 Safe/);
    assert.ok(buttons(shown).includes('set:quick'));

    await t.click('set:rating:sensitive');
    await t.click('set:count:5');
    await t.click('set:quick');
    await t.click('set:safe');
    await t.click('set:albums');
    assert.deepEqual(await t.userData.settings.get(42), { rating: 'sensitive', count: 5, quick: true, safe: true, albums: false, source: 'danbooru', hide: [] });
    assert.match(tg.calls('editMessageText').at(-1).payload.text, /Безопасный режим.*✅ вкл/);

    tg.clear();
    await t.click('set:count:7'); // нет такого варианта
    await t.click('set:rating:bogus');
    assert.deepEqual(tg.methods(), ['answerCallbackQuery', 'answerCallbackQuery']);
});

test('/settings: быстрые фильтры «скрывать яой» и т.п.', async () => {
    const t = createTestBot();
    await t.click('set:hide:yaoi');
    await t.click('set:hide:furry');
    assert.deepEqual((await t.userData.settings.get(42)).hide, ['yaoi', 'furry']);
    assert.match(tg.calls('editMessageText').at(-1).payload.text, /Скрывать: 👨‍❤️‍👨 яой \/ парни, 🐾 фурри/);
    await t.click('set:hide:furry');
    assert.deepEqual((await t.userData.settings.get(42)).hide, ['yaoi']);
    tg.clear();
    await t.click('set:hide:unknown');
    assert.deepEqual(tg.methods(), ['answerCallbackQuery']);

    // Поиск: яой отсеивается, у Danbooru берётся больше постов
    const seen = [];
    t.client.posts = async (params) => (seen.push(params), [
        makePost({ tag_string: 'anal yaoi 2boys' }),
        makePost({ tag_string: 'anal male_focus' }),
        makePost({ tag_string: 'anal 1girl' })
    ]);
    tg.clear();
    await t.click('s:explicit:3', { text: '🔹 anal' });
    await t.settle();
    assert.equal(tg.calls('sendPhoto').length, 1);
    assert.equal(seen[0].limit, 200);
});

test('settingsView: отметка текущих значений', () => {
    const { extra } = settingsView({ rating: 'any', count: 3, quick: false, safe: false }, [1, 3]);
    const flat = extra.reply_markup.inline_keyboard.flat();
    assert.ok(flat.find(b => b.callback_data === 'set:rating:any').text.startsWith('✅'));
    assert.ok(flat.find(b => b.callback_data === 'set:count:3').text.startsWith('✅'));
});

test('рейтинг по умолчанию из настроек используется в текстовом поиске и /random', async () => {
    const t = createTestBot();
    await t.userData.settings.update(42, { rating: 'sensitive' });
    await t.text('hatsune miku');
    assert.match(tg.calls('editMessageText').at(-1).payload.text, /🟡 Sensitive/);

    await t.text('/random');
    await t.settle();
    assert.ok(t.client.calls.find(c => c[0] === 'posts')[1].tags.includes('rating:s'));
});

test('безопасный режим: 18+ превращается в safe везде', async () => {
    const t = createTestBot();
    await t.userData.settings.update(42, { safe: true });

    await t.text('hatsune miku nsfw');
    assert.match(tg.calls('editMessageText').at(-1).payload.text, /🟢 Safe/);

    tg.clear();
    await t.click('s:explicit:1', { text: '🔹 hatsune_miku' });
    await t.settle();
    assert.ok(tg.calls('sendMessage').some(c => /Включён безопасный режим/.test(c.payload.text)));
    assert.ok(t.client.calls.filter(c => c[0] === 'posts').every(c => !c[1].tags.includes('rating:e')));

    // /top и похожие не показывают 18+ посты
    tg.clear();
    await t.text('/top nsfw');
    await t.settle();
    assert.equal(tg.calls('sendPhoto').length, 2);

    const adult = createTestBot({ client: fakeClient({ similarToPost: async () => [{ postId: 9, score: 90, post: makePost({ id: 9, rating: 'e' }) }] }) });
    await adult.userData.settings.update(42, { safe: true });
    tg.clear();
    await adult.click('sim:1');
    await adult.settle();
    assert.equal(tg.calls('sendPhoto').length, 0);
});

test('быстрый режим: поиск сразу, без вопроса', async () => {
    const t = createTestBot();
    await t.userData.settings.update(42, { quick: true, count: 1 });
    await t.text('hatsune miku');
    assert.match(tg.calls('editMessageText').at(-1).payload.text, /Быстрый режим: ищу 1 шт/);
    await t.settle();
    assert.equal(tg.calls('sendPhoto').length, 1);
    assert.match(lastText(), /Готово/);
});

test('быстрый режим: если занят — «подожди»', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const client = fakeClient({ posts: async () => { await gate; return []; } });
    const t = createTestBot({ client });
    await t.userData.settings.update(42, { quick: true });
    await t.click('s:general:1', { text: '🔹 hatsune_miku' });
    await t.text('hatsune miku');
    assert.match(lastText(), /Подожди/);
    release();
    await t.settle();
});

// ---------- Подсказки при опечатках ----------

test('опечатка: «возможно, ты имел в виду» и кнопка запускает поиск', async () => {
    const t = createTestBot();
    await t.text('hatsue miku');
    const edit = tg.calls('editMessageText').at(-1).payload;
    assert.match(edit.text, /Возможно, ты имел в виду/);
    assert.deepEqual(buttons(edit), ['st:hatsune_miku']);

    tg.clear();
    await t.click('st:hatsune_miku');
    await t.settle();
    assert.equal(tg.calls('sendPhoto').length, 3);
    assert.equal(t.client.calls.filter(c => c[0] === 'posts')[0][1].tags[0], 'hatsune_miku');
});

test('опечатка вместе с найденным тегом: подсказки под кнопками поиска', async () => {
    const t = createTestBot();
    await t.text('swimsuit, hatsue miku');
    const edit = tg.calls('editMessageText').at(-1).payload;
    const data = buttons(edit);
    assert.ok(data.includes('s:general:3'));
    assert.equal(data.at(-1), 'st:hatsune_miku');
});

test('быстрый режим показывает подсказки; st: при занятом чате', async () => {
    const t = createTestBot();
    await t.userData.settings.update(42, { quick: true, count: 1 });
    await t.text('swimsuit, hatsue miku');
    assert.ok(buttons(tg.calls('editMessageText').at(-1).payload).includes('st:hatsune_miku'));
    await t.settle();

    let release;
    const gate = new Promise(resolve => { release = resolve; });
    t.client.posts = async () => { await gate; return []; };
    await t.click('s:general:1', { text: '🔹 swimsuit' });
    await t.click('st:hatsune_miku');
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /Подожди/);
    release();
    await t.settle();
});

// ---------- Оригинал ----------

test('📥 оригинал: документом по ссылке, большой — ссылкой, скрытый — сообщение', async () => {
    const t = createTestBot({ client: fakeClient({ post: async (id) => makePost({ id, file_size: 5 * 1024 * 1024 }) }) });
    await t.click('dl:7');
    await t.settle();
    const doc = tg.calls('sendDocument').at(-1).payload;
    assert.match(doc.document, /original\/7\.jpg/);
    assert.match(doc.caption, /Оригинал · 800×600 · 5\.0 МБ/);

    tg.clear();
    const huge = createTestBot({ client: fakeClient({ post: async (id) => makePost({ id, file_size: 80 * 1024 * 1024 }) }) });
    await huge.click('dl:7');
    await huge.settle();
    assert.match(lastText(), /слишком большой/);

    tg.clear();
    const hidden = createTestBot({ client: fakeClient({ post: async (id) => makePost({ id, file_url: undefined }) }) });
    await hidden.click('dl:7');
    await hidden.settle();
    assert.match(lastText(), /недоступен/);
});

test('📥 оригинал 20–50 МБ скачивается и загружается; при ошибке — ссылка', async () => {
    const fetchMock = mockFetch(async () => new Response(new Uint8Array([1, 2, 3])));
    try {
        const t = createTestBot({ client: fakeClient({ post: async (id) => makePost({ id, file_size: 30 * 1024 * 1024 }) }) });
        await t.click('dl:7');
        await t.settle();
        assert.equal(tg.calls('sendDocument').length, 1);
        assert.equal(fetchMock.calls.length, 1);
    } finally {
        fetchMock.restore();
    }

    tg.restore();
    tg = mockTelegram((method) => { if (method === 'sendDocument') throw new Error('bad'); return undefined; });
    const failing = mockFetch(async () => new Response('no', { status: 500 }));
    try {
        const t = createTestBot({ client: fakeClient({ post: async (id) => makePost({ id, file_url: '/data/x.jpg' }) }) });
        await t.click('dl:7');
        await t.settle();
        assert.match(lastText(), /https:\/\/danbooru\.donmai\.us\/data\/x\.jpg/);
    } finally {
        failing.restore();
    }
});

// ---------- Для тебя ----------

test('favoriteTags и pickWeighted', () => {
    const tags = favoriteTags([
        makePost({ tag_string_character: 'rem', tag_string_copyright: 'original re:zero', tag_string_artist: 'a' }),
        makePost({ tag_string_character: 'rem ram', tag_string_copyright: 're:zero', tag_string_artist: '' })
    ]);
    assert.deepEqual(tags.slice(0, 2), [{ tag: 'rem', count: 2 }, { tag: 're:zero', count: 2 }]);
    assert.ok(!tags.some(t => t.tag === 'original'));

    const items = [{ tag: 'a', count: 1 }, { tag: 'b', count: 3 }];
    assert.equal(pickWeighted(items, () => 0).tag, 'a');
    assert.equal(pickWeighted(items, () => 0.9).tag, 'b');
    assert.equal(pickWeighted(items, () => 1).tag, 'a');
});

test('/foryou: без избранного, по избранному, без тегов', async () => {
    const t = createTestBot();
    await t.text('/foryou');
    await t.settle();
    assert.match(lastText(), /Сначала добавь/);

    await t.userData.favorites.toggle(42, 1);
    tg.clear();
    await t.text('/foryou');
    await t.settle();
    assert.match(tg.calls('sendPhoto')[0].payload.caption, /Для тебя:<\/b>/);

    const bare = createTestBot({
        client: fakeClient({ postsByIds: async (ids) => ids.map(id => makePost({ id, tag_string_character: '', tag_string_copyright: '', tag_string_artist: '' })) })
    });
    await bare.userData.favorites.toggle(42, 1);
    await bare.text('/foryou');
    await bare.settle();
    assert.match(lastText(), /Не получилось понять твой вкус/);
});

// ---------- Викторина ----------

test('buildQuestion: один персонаж, 4 разных варианта, лимит callback', () => {
    const random = () => 0.5;
    const posts = [
        makePost({ id: 1, tag_string_character: 'rem ram' }), // два персонажа — пропуск
        makePost({ id: 2, tag_string_character: 'rem_(re:zero)' }),
        makePost({ id: 3, tag_string_character: 'frieren' }),
        makePost({ id: 4, tag_string_character: 'x'.repeat(70) })
    ];
    const q = buildQuestion(posts, random);
    assert.equal(q.post.id, 2);
    assert.equal(q.answer, 'rem_(re:zero)');
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4);
    assert.ok(q.options.includes('frieren'));
    assert.ok(q.options.every(o => o.length < 60));

    assert.equal(buildQuestion([makePost({ tag_string_character: '' })]), null);
    assert.deepEqual(shuffle([1, 2, 3], () => 0).sort(), [1, 2, 3]);
    assert.ok(FALLBACK_CHARACTERS.length >= 3);
});

test('/quiz: вопрос, верный ответ, неверный ответ, рейтинг', async () => {
    const posts = [makePost({ id: 50, tag_string_character: 'frieren' }), makePost({ id: 51, tag_string_character: 'fern_(sousou_no_frieren)' })];
    const client = fakeClient({
        posts: async () => posts,
        post: async (id) => posts.find(p => p.id === id)
    });
    const t = createTestBot({ client });
    await t.text('/quiz');
    await t.settle();
    const question = tg.calls('sendPhoto').at(-1).payload;
    assert.equal(question.caption, '🎮 <b>Угадай персонажа!</b>');
    const options = buttons(question);
    assert.equal(options.length, 4);
    assert.ok(options.every(o => o.startsWith('qa:50:')));

    await t.click('qa:50:frieren');
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /Верно! Серия: 1/);
    const revealed = tg.calls('editMessageCaption').at(-1).payload;
    assert.match(revealed.caption, /User<\/b>: верно/);
    assert.deepEqual(buttons(revealed), ['quiz', 'quiztop']);

    await t.click('qa:50:hatsune_miku');
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /Это Frieren/);
    assert.match(tg.calls('editMessageCaption').at(-1).payload.caption, /мимо — это <b>Frieren/);

    await t.click('quiztop');
    assert.match(lastText(), /🥇 User — 1\/2 \(лучшая серия 1\)/);

    tg.clear();
    await t.click('quiz');
    await t.settle();
    assert.equal(tg.calls('sendPhoto').length, 1);
});

test('/quiz: нет подходящих постов, картинка не ушла, пустой рейтинг, ошибка поста', async () => {
    const empty = createTestBot({ client: fakeClient({ posts: async () => [] }) });
    await empty.text('/quiz');
    await empty.settle();
    assert.match(lastText(), /Не получилось придумать вопрос/);

    await empty.text('/quiztop');
    assert.match(lastText(), /Пока никто не играл/);

    tg.restore();
    tg = mockTelegram((method) => { if (method === 'sendPhoto') throw new Error('bad'); return undefined; });
    const fetchMock = mockFetch(async () => new Response('no', { status: 404 }));
    try {
        const broken = createTestBot();
        await broken.text('/quiz');
        await broken.settle();
        assert.match(lastText(), /Картинка не загрузилась/);
    } finally {
        fetchMock.restore();
    }

    const noPost = createTestBot({ client: fakeClient({ post: async () => { throw new Error('404'); } }) });
    await noPost.click('qa:1:rem');
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /404/);
});

test('/quiz и кнопка «ещё», пока чат занят', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const t = createTestBot({ client: fakeClient({ posts: async () => { await gate; return []; } }) });
    await t.text('/quiz');
    await t.text('/quiz');
    assert.match(lastText(), /Подожди/);
    await t.click('quiz');
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /Подожди/);
    release();
    await t.settle();
});

// ---------- /info ----------

test('/info: вики, другие названия, связанные теги и кнопки', async () => {
    const t = createTestBot();
    await t.text('/info hatsune miku');
    const message = tg.calls('sendMessage').at(-1).payload;
    assert.match(message.text, /ℹ️ <b>Hatsune Miku<\/b>/);
    assert.match(message.text, /100k артов/);
    assert.match(message.text, /Также: 初音ミク/);
    assert.match(message.text, /Miku is a vocaloid character/);
    assert.match(message.text, /Связано: <code>vocaloid<\/code>/);
    assert.match(message.text, /🔹 <code>hatsune_miku<\/code>/);
    const data = buttons(message);
    assert.ok(data.includes('s:general:3'));
    assert.ok(data.includes('sub:general'));
    assert.ok(data.includes('st:vocaloid'));
});

test('/info: без аргумента, не найдено с подсказкой, без вики', async () => {
    const t = createTestBot({ client: fakeClient({ wiki: async () => null, relatedTags: async () => { throw new Error('x'); } }) });
    await t.text('/info');
    assert.match(lastText(), /про что рассказать/);

    await t.text('/info hatsue miku');
    const notFound = tg.calls('sendMessage').at(-1).payload;
    assert.match(notFound.text, /Не нашёл тег/);
    assert.deepEqual(buttons(notFound), ['st:hatsune_miku']);

    await t.text('/info qwertyuiop');
    assert.equal(tg.calls('sendMessage').at(-1).payload.reply_markup, undefined);

    await t.text('/info swimsuit');
    const bare = tg.calls('sendMessage').at(-1).payload;
    assert.match(bare.text, /🏷 Тег · 🖼 300k артов/);
    assert.doesNotMatch(bare.text, /Связано/);
});

// ---------- Админка ----------

test('админ-команды выключены без ADMIN_IDS и закрыты для чужих', async () => {
    const t = createTestBot();
    await t.text('/admin');
    assert.match(lastText(), /задай ADMIN_IDS/);

    const other = createTestBot({ config: testConfig({ adminIds: [1] }) });
    await other.text('/post');
    assert.match(lastText(), /только для админов/);
    await other.click('adm:toggle');
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /Только для админов/);
});

test('админка: статус, пауза/продолжение, пост сейчас, топ недели', async () => {
    const config = testConfig({ adminIds: [42] });
    const t = createTestBot({ config });
    await t.text('/admin');
    let panel = tg.calls('sendMessage').at(-1).payload;
    assert.match(panel.text, /Автопост: ▶️ работает/);
    assert.deepEqual(buttons(panel), ['adm:toggle', 'adm:post', 'adm:recap']);

    await t.text('/pause');
    assert.equal(await t.store.get(PAUSED_KEY), true);
    await t.text('/admin');
    assert.match(lastText(), /на паузе/);
    await t.text('/resume');
    assert.equal(await t.store.get(PAUSED_KEY), null);

    await t.click('adm:toggle');
    assert.equal(await t.store.get(PAUSED_KEY), true);
    assert.match(tg.calls('editMessageText').at(-1).payload.text, /на паузе/);
    await t.click('adm:toggle');
    assert.equal(await t.store.get(PAUSED_KEY), null);

    // /post работает даже на паузе
    await t.store.set(PAUSED_KEY, true);
    tg.clear();
    await t.text('/post');
    assert.ok(tg.calls('sendPhoto').some(c => c.payload.chat_id === '@test_channel') || tg.calls('sendMediaGroup').length);
    assert.match(lastText(), /Готово/);

    await t.text('/recap');
    assert.match(lastText(), /нет постов с реакциями/);

    await t.channelStats.recordPost(77, makePost());
    await t.channelStats.updateReactions(77, 4);
    tg.clear();
    await t.click('adm:recap');
    const recap = tg.calls('sendMessage').find(c => c.payload.chat_id === '@test_channel').payload;
    assert.match(recap.text, /Топ недели/);
    assert.match(recap.text, /t\.me\/test_channel\/77/);
    assert.match(lastText(), /Топ недели опубликован/);

    tg.clear();
    t.client.posts = async () => [];
    await t.click('adm:post');
    assert.match(lastText(), /Не нашлось новой картинки/);

    config.autopost.enabled = false;
    await t.text('/admin');
    assert.match(lastText(), /выключен/);
    config.autopost.enabled = true;
    config.autopost.quietHours = { start: '00:00', end: '23:59' };
    config.autopost.timeZone = 'UTC';
    await t.store.del(PAUSED_KEY);
    await t.channelStats.recordPost(78, makePost());
    await t.text('/admin');
    assert.match(lastText(), /тихие часы/);
    assert.match(lastText(), /Лучше всего заходят/);
});
