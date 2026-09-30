// Общие фейки для тестов: Danbooru, Telegram, зависимости бота.
import { Telegram } from 'telegraf';
import { config as realConfig } from '../../src/config.js';
import { MemoryStore } from '../../src/services/store.js';
import { MemoryHistory } from '../../src/services/history.js';
import { createUserData } from '../../src/services/userData.js';
import { createChannelStats } from '../../src/services/channelStats.js';
import { createTagResolver } from '../../src/services/tagResolver.js';
import { createSearchRunner } from '../../src/bot/searchRunner.js';
import { createBot } from '../../src/bot/createBot.js';

export const BASE = 'https://danbooru.donmai.us';

let nextId = 1000;

/** Пост Danbooru с разумными значениями по умолчанию. */
export function makePost(overrides = {}) {
    const id = overrides.id ?? nextId++;
    return {
        id,
        md5: `md5_${id}`,
        rating: 'g',
        score: 10,
        file_ext: 'jpg',
        file_size: 100_000,
        file_url: `https://cdn.donmai.us/original/${id}.jpg`,
        large_file_url: `https://cdn.donmai.us/sample/${id}.jpg`,
        preview_file_url: `https://cdn.donmai.us/preview/${id}.jpg`,
        image_width: 800,
        image_height: 600,
        tag_string: 'hatsune_miku vocaloid 1girl smile',
        tag_string_general: '1girl smile',
        tag_string_character: 'hatsune_miku',
        tag_string_copyright: 'vocaloid',
        tag_string_artist: 'some_artist',
        created_at: '2024-05-01T10:00:00.000Z',
        source: 'https://www.pixiv.net/artworks/1',
        ...overrides
    };
}

/** Фейковый клиент Danbooru. Все методы можно переопределить. */
export function fakeClient(overrides = {}) {
    const calls = [];
    const tags = { hatsune_miku: 100_000, swimsuit: 300_000, uzumaki_naruto: 50_000, some_artist: 500, male_focus: 90_000 };
    const client = {
        baseUrl: BASE,
        calls,
        postUrl: (id) => `${BASE}/posts/${id}`,
        async posts(params) {
            calls.push(['posts', params]);
            return [makePost(), makePost(), makePost()];
        },
        async post(id) {
            calls.push(['post', id]);
            return makePost({ id });
        },
        async postsByIds(ids) {
            calls.push(['postsByIds', ids]);
            return ids.map(id => makePost({ id }));
        },
        async popular(params) {
            calls.push(['popular', params]);
            return [makePost({ rating: 'g' }), makePost({ rating: 'e' }), makePost({ rating: 'g' })];
        },
        async similarToPost(id) {
            calls.push(['similarToPost', id]);
            return [{ postId: id, score: 100, post: makePost({ id }) }, { postId: 77, score: 90, post: null }];
        },
        async similarToFile() {
            calls.push(['similarToFile']);
            return [{ postId: 55, score: 95, post: makePost({ id: 55 }) }];
        },
        async tagByName(name) {
            return name in tags ? { name, post_count: tags[name], category: 0 } : null;
        },
        async aliasOf() {
            return null;
        },
        async autocomplete() {
            return [];
        },
        async tagsMatching() {
            return [];
        },
        async tagsFuzzy(name) {
            calls.push(['tagsFuzzy', name]);
            return name === 'hatsue_miku' ? [{ name: 'hatsune_miku', post_count: 100_000, category: 4 }] : [];
        },
        async wiki(title) {
            calls.push(['wiki', title]);
            return { title, body: 'h4. Appearance\n[b]Miku[/b] is a [[vocaloid]] character.', other_names: ['初音ミク'] };
        },
        async relatedTags(query) {
            calls.push(['relatedTags', query]);
            return [{ name: 'vocaloid', category: 3, postCount: 200_000 }, { name: 'twintails', category: 0, postCount: 1 }];
        },
        ...overrides
    };
    return client;
}

/** Конфиг для тестов: без задержек. */
export function testConfig(overrides = {}) {
    const config = structuredClone(realConfig);
    config.botToken = '123:TEST';
    config.search.sendDelayMs = 0;
    config.autopost.channelId = '@test_channel';
    config.autopost.quietHours = null;
    config.adminIds = [];
    return Object.assign(config, overrides);
}

/**
 * Подменяет Telegram API: все вызовы пишутся в лог, ответы — фейковые.
 * @param {(method, payload) => any} [responder] — свой ответ на вызов
 */
export function mockTelegram(responder) {
    const log = [];
    const original = Telegram.prototype.callApi;
    let messageId = 500;
    Telegram.prototype.callApi = async function (method, payload) {
        log.push({ method, payload });
        const custom = responder ? await responder(method, payload) : undefined;
        if (custom !== undefined) return custom;
        if (method === 'sendMediaGroup') return payload.media.map(() => ({ message_id: ++messageId }));
        if (method === 'getFile') return { file_id: payload.file_id, file_path: 'photos/file.jpg' };
        if (method === 'getMe') return { id: 1, is_bot: true, username: 'test_bot' };
        return { message_id: ++messageId, chat: { id: payload?.chat_id } };
    };
    return {
        log,
        calls: (method) => log.filter(entry => entry.method === method),
        methods: () => log.map(entry => entry.method),
        clear: () => { log.length = 0; },
        restore: () => { Telegram.prototype.callApi = original; }
    };
}

/** Собирает бота с фейковыми зависимостями. */
export function createTestBot({ client = fakeClient(), config = testConfig() } = {}) {
    const tasks = [];
    const store = new MemoryStore();
    const history = new MemoryHistory();
    const userData = createUserData(store);
    const channelStats = createChannelStats(store);
    const runTask = (promise) => tasks.push(promise);
    const runner = createSearchRunner({ client, config, userData, runTask });
    const resolver = createTagResolver(client);
    const deps = { config, client, resolver, history, store, userData, channelStats, runner, runTask };
    const bot = createBot(deps);
    bot.botInfo = { id: 1, is_bot: true, username: 'test_bot', first_name: 'Test' };

    let updateId = 1;
    const user = { id: 42, is_bot: false, first_name: 'User' };
    const chat = { id: 42, type: 'private' };

    return {
        ...deps,
        bot,
        user,
        chat,
        /** Ждёт все фоновые задачи (включая запущенные из задач). */
        async settle() {
            while (tasks.length) await Promise.all(tasks.splice(0));
        },
        text(text) {
            const entities = text.startsWith('/')
                ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }]
                : undefined;
            return bot.handleUpdate({
                update_id: updateId++,
                message: { message_id: updateId, date: 0, chat, from: user, text, entities }
            });
        },
        message(fields) {
            return bot.handleUpdate({ update_id: updateId++, message: { message_id: updateId, date: 0, chat, from: user, ...fields } });
        },
        click(data, message = {}) {
            return bot.handleUpdate({
                update_id: updateId++,
                callback_query: {
                    id: String(updateId), from: user, chat_instance: 'ci', data,
                    message: { message_id: 900, date: 0, chat, text: '', ...message }
                }
            });
        },
        inline(query, offset = '') {
            return bot.handleUpdate({
                update_id: updateId++,
                inline_query: { id: String(updateId), from: user, query, offset }
            });
        },
        update(fields) {
            return bot.handleUpdate({ update_id: updateId++, ...fields });
        }
    };
}

/** Подмена глобального fetch на время теста. */
export function mockFetch(handler) {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        return handler(String(url), init);
    };
    return { calls, restore: () => { globalThis.fetch = original; } };
}

export const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
});

/** Текст сообщения без HTML — так его видит бот в callback_query.message.text */
export const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
