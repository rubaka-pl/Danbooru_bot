import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestBot, fakeClient, makePost, mockTelegram, testConfig } from './helpers/fakes.js';
import { parseWallpaperArgs, WALLPAPER_FILTERS } from '../src/bot/handlers/profile.js';
import { autopostOnce } from '../src/services/autopost.js';
import { MemoryHistory } from '../src/services/history.js';
import { MemoryStore } from '../src/services/store.js';
import { createChannelStats } from '../src/services/channelStats.js';
import { createUserData } from '../src/services/userData.js';

let tg;
beforeEach(() => { tg = mockTelegram(); });
afterEach(() => tg.restore());

const lastText = (method = 'sendMessage') => tg.calls(method).at(-1)?.payload.text;
const buttons = (payload) => (payload.reply_markup?.inline_keyboard ?? []).flat().map(b => b.callback_data);

// ---------- Битва артов ----------

function battleDeps({ posts } = {}) {
    const store = new MemoryStore();
    const calls = [];
    const telegram = {
        calls,
        async sendMediaGroup(chatId, media) { calls.push(['sendMediaGroup', media]); return media.map((_, i) => ({ message_id: 10 + i })); },
        async sendPoll(chatId, question, options, extra) { calls.push(['sendPoll', question, options, extra]); return { message_id: 20, poll: { id: 'poll-1' } }; },
        async sendPhoto() { calls.push(['sendPhoto']); return { message_id: 30 }; }
    };
    let n = 0;
    const client = fakeClient({
        posts: async () => posts ?? [
            makePost({ id: 100 + n++, tag_string_character: 'rem', tag_string: 'rem 1girl' }),
            makePost({ id: 200 + n++, tag_string_character: 'ram', tag_string: 'ram 1girl' })
        ]
    });
    return { telegram, client, history: new MemoryHistory(), config: testConfig(), store, channelStats: createChannelStats(store) };
}

test('битва артов: альбом из двух + опрос, голоса идут в статистику', async (t) => {
    t.mock.method(console, 'log', () => {});
    // general, без лайков, битва
    const values = [0.9, 0.9, 0.01];
    t.mock.method(Math, 'random', () => values.shift() ?? 0.9);
    const deps = battleDeps();
    assert.equal(await autopostOnce(deps), 'battle');

    const [album, poll] = deps.telegram.calls;
    assert.equal(album[0], 'sendMediaGroup');
    assert.match(album[1][0].caption, /Битва артов:<\/b> Rem vs Ram/);
    assert.equal(poll[0], 'sendPoll');
    assert.deepEqual(poll[2].map(o => o.text), ['1️⃣ Rem', '2️⃣ Ram']);
    assert.equal(poll[3].is_anonymous, true);
    assert.equal(deps.history.items.size, 2);

    assert.equal(await deps.channelStats.updatePoll('poll-1', [5, 2]), true);
    assert.equal(await deps.channelStats.updatePoll('poll-1', [5, 2]), true); // без изменений
    assert.equal(await deps.channelStats.updatePoll('unknown', [1]), false);
    const stats = await deps.store.get('ch:tagstats');
    assert.deepEqual([stats.rem, stats.ram], [[1, 5], [1, 2]]);
    await deps.channelStats.updatePoll('poll-1', [3, 2]); // голоса отозвали
    assert.deepEqual((await deps.store.get('ch:tagstats')).rem, [1, 3]);
});

test('битва: по «залайканным» тегам; не собралась — обычный пост', async (t) => {
    t.mock.method(console, 'log', () => {});
    const deps = battleDeps();
    for (const [id, tag] of [[1, 'rem'], [2, 'rem'], [3, 'ram'], [4, 'ram']]) {
        await deps.channelStats.recordPost(id, makePost({ tag_string_character: tag, tag_string_copyright: '', tag_string_artist: '' }));
    }
    await deps.channelStats.updateReactions(1, 5);
    await deps.channelStats.updateReactions(3, 5);
    // general, лайк (+ выбор), битва (0.01 < 1/25), выбор второго
    t.mock.method(Math, 'random', () => 0.01);
    deps.config.autopost.sensitiveEvery = 1000;
    assert.equal(await autopostOnce(deps), 'battle');

    // Все посты уже были — битва не собирается, падаем на обычный пост и тоже ничего
    const empty = battleDeps({ posts: [makePost({ tag_string_character: 'solo_char' })] });
    t.mock.method(Math, 'random', () => 0.01);
    empty.config.autopost.albumEvery = 0;
    assert.equal(await autopostOnce(empty), 'posted');
    assert.equal(empty.telegram.calls[0][0], 'sendPhoto');
});

test('битва: второй боец без свежих постов — отказ', async (t) => {
    t.mock.method(console, 'log', () => {});
    const deps = battleDeps();
    const seenPosts = [makePost({ id: 1, tag_string_character: 'a', tag_string: 'a' }), makePost({ id: 2, tag_string_character: 'b', tag_string: 'b' })];
    deps.client.posts = async () => seenPosts;
    for (const p of seenPosts) await deps.history.add(p.md5);
    t.mock.method(Math, 'random', () => 0.01);
    deps.config.autopost.albumEvery = 0;
    assert.equal(await autopostOnce(deps), 'empty');
});

test('опрос в канале → статистика через обновление poll', async () => {
    const t = createTestBot();
    await t.channelStats.recordBattle('p1', ['rem', 'ram']);
    await t.update({ poll: { id: 'p1', question: 'q', options: [{ text: 'a', voter_count: 4 }, { text: 'b', voter_count: 1 }], total_voter_count: 5, is_closed: false, is_anonymous: true, type: 'regular', allows_multiple_answers: false } });
    const stats = await t.store.get('ch:tagstats');
    assert.deepEqual(stats, { rem: [1, 4], ram: [1, 1] });

    t.channelStats.updatePoll = async () => { throw new Error('down'); };
    await t.update({ poll: { id: 'p1', options: [] } }); // не падает
});

// ---------- Поделиться ----------

test('inline id:123 — конкретный арт для «📤 Поделиться»', async () => {
    const t = createTestBot();
    await t.inline('id:777');
    const answer = tg.calls('answerInlineQuery').at(-1).payload;
    assert.equal(answer.results.length, 1);
    assert.equal(answer.results[0].id, '777');
    await t.inline('#778');
    assert.equal(tg.calls('answerInlineQuery').at(-1).payload.results[0].id, '778');

    const photo = tg.calls('answerInlineQuery').at(-1).payload.results[0];
    assert.equal(photo.type, 'photo');
});

// ---------- Обои ----------

test('parseWallpaperArgs', () => {
    assert.deepEqual(parseWallpaperArgs(''), { device: 'desktop', query: '' });
    assert.deepEqual(parseWallpaperArgs('phone frieren'), { device: 'phone', query: 'frieren' });
    assert.deepEqual(parseWallpaperArgs('Мику телефон'), { device: 'phone', query: 'Мику' });
    assert.deepEqual(parseWallpaperArgs('ПК genshin impact'), { device: 'desktop', query: 'genshin impact' });
    assert.deepEqual(parseWallpaperArgs(), { device: 'desktop', query: '' });
    assert.ok(WALLPAPER_FILTERS.phone.tags.includes('ratio:<=0.65'));
});

test('/wallpaper: оригиналы документом с фильтром размера', async () => {
    const seen = [];
    const client = fakeClient({ posts: async (params) => (seen.push(params), [makePost({ id: 1 }), makePost({ id: 2, file_ext: 'gif' }), makePost({ id: 3 })]) });
    const t = createTestBot({ client });
    await t.text('/wallpaper phone hatsune miku');
    await t.settle();
    const docs = tg.calls('sendDocument');
    assert.equal(docs.length, 2); // gif пропущен
    assert.match(docs[0].payload.caption, /📱 Обои для телефона/);
    assert.ok(seen[0].tags.includes('ratio:<=0.65'));
    assert.ok(seen[0].tags.includes('hatsune_miku'));

    tg.clear();
    await t.text('/wall');
    await t.settle();
    assert.match(tg.calls('sendDocument')[0].payload.caption, /🖥 Обои для компьютера/);
});

test('/wallpaper: неизвестный тег и ничего не найдено', async () => {
    const t = createTestBot({ client: fakeClient({ posts: async () => [] }) });
    await t.text('/wallpaper qwertyuiop');
    await t.settle();
    assert.match(lastText(), /Не нашёл: qwertyuiop/);
    await t.text('/wallpaper');
    await t.settle();
    assert.match(lastText(), /Не нашёл обоев/);
});

// ---------- Профиль и история ----------

test('/me: пустой и заполненный профиль', async () => {
    const t = createTestBot();
    await t.text('/me');
    assert.match(lastText(), /Избранное: 0/);
    assert.match(lastText(), /ещё не играл/);
    assert.doesNotMatch(lastText(), /Твой вкус/);

    await t.userData.favorites.toggle(42, 5);
    await t.userData.subscriptions.add(42, { tags: ['a'], rating: 'general', lastId: 0 });
    await t.userData.quiz.record({ id: 42, first_name: 'User' }, true);
    await t.userData.settings.update(42, { quick: true });
    await t.text('/me');
    assert.match(lastText(), /Избранное: 1 · 🔔 Подписок: 1/);
    assert.match(lastText(), /Викторина: 1\/1/);
    assert.match(lastText(), /быстрый вкл/);
    assert.match(lastText(), /Твой вкус: Hatsune Miku/);
});

test('/history: запись, повтор, очистка', async () => {
    const t = createTestBot();
    await t.text('/history');
    assert.match(lastText(), /История пуста/);

    await t.text('hatsune miku, -swimsuit');
    await t.text('uzumaki naruto');
    await t.text('hatsune miku, -swimsuit'); // дубль поднимается наверх
    await t.click('st:some_artist');
    assert.deepEqual(await t.userData.history.list(42), [['some_artist'], ['hatsune_miku', '-swimsuit'], ['uzumaki_naruto']]);
    await t.settle();

    await t.text('/history');
    const shown = tg.calls('sendMessage').at(-1).payload;
    assert.match(shown.text, /2\. <code>hatsune_miku \+ -swimsuit<\/code>/);
    assert.deepEqual(buttons(shown), ['h:0', 'h:1', 'h:2', 'h:clear']);

    tg.clear();
    await t.click('h:1');
    await t.settle();
    const search = t.client.calls.filter(c => c[0] === 'posts').at(-1)[1];
    assert.ok(search.tags.includes('hatsune_miku')); // -swimsuit фильтруется ботом (лимит тегов)

    await t.click('h:9');
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /не найден/);

    await t.click('h:clear');
    assert.deepEqual(await t.userData.history.list(42), []);
    assert.match(tg.calls('editMessageText').at(-1).payload.text, /История пуста/);
});

test('история: лимит 10 и пустой запрос', async () => {
    const { history } = createUserData(new MemoryStore());
    for (let i = 0; i < 12; i++) await history.add(1, [`t${i}`]);
    await history.add(1, []);
    const list = await history.list(1);
    assert.equal(list.length, 10);
    assert.deepEqual(list[0], ['t11']);
});

test('/history: повтор, пока чат занят', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const t = createTestBot({ client: fakeClient({ posts: async () => { await gate; return []; } }) });
    await t.userData.history.add(42, ['a']);
    await t.click('s:general:1', { text: '🔹 a' });
    await t.click('h:0');
    assert.match(tg.calls('answerCallbackQuery').at(-1).payload.text, /Подожди/);
    release();
    await t.settle();
});

// ---------- Лимит в час ----------

test('лимит картинок в час: сообщение вместо поиска, админам не действует', async () => {
    const config = testConfig();
    config.search.hourlyLimit = 2;
    const t = createTestBot({ config });
    await t.click('s:general:3', { text: '🔹 hatsune_miku' });
    await t.settle();
    assert.equal(tg.calls('sendPhoto').length, 2);
    assert.ok(tg.calls('sendMessage').some(c => /Передохни/.test(c.payload.text)));

    tg.clear();
    await t.click('s:general:3', { text: '🔹 hatsune_miku' });
    await t.settle();
    assert.equal(tg.calls('sendPhoto').length, 0);
    assert.match(lastText(), /Передохни ~\d+ мин/);

    const adminConfig = testConfig({ adminIds: [42] });
    adminConfig.search.hourlyLimit = 1;
    const admin = createTestBot({ config: adminConfig });
    tg.clear();
    await admin.click('s:general:3', { text: '🔹 hatsune_miku' });
    await admin.settle();
    assert.equal(tg.calls('sendPhoto').length, 3);
});

test('ошибка в обработчике → уведомление админу', async (t) => {
    t.mock.method(console, 'error', () => {});
    const bot = createTestBot({ config: testConfig({ adminIds: [7] }) });
    bot.userData.favorites.toggle = async () => { throw new Error('kaput'); };
    await bot.click('f:1');
    await new Promise(resolve => setImmediate(resolve));
    const alert = tg.calls('sendMessage').find(c => c.payload.chat_id === 7);
    assert.match(alert.payload.text, /🚨 Ошибка в обработчике \(callback_query\): kaput/);
});
