import { pickMedia } from '../utils/posts.js';
import { buildCaption } from '../utils/format.js';

const MAX_UPLOAD = { photo: 10 * 1024 * 1024, animation: 50 * 1024 * 1024, video: 50 * 1024 * 1024 };

const METHODS = {
    photo: 'sendPhoto',
    animation: 'sendAnimation',
    video: 'sendVideo'
};

/**
 * Ошибки, которые не связаны с самой картинкой: лимит запросов, бот заблокирован,
 * чат не найден. Их нет смысла «лечить» загрузкой файла — пробрасываем выше.
 */
export function isFatalTelegramError(error) {
    const code = error?.response?.error_code;
    if (code === 429 || code === 403) return true;
    return code === 400 && /chat not found|chat_id is empty|peer_id_invalid/i.test(error?.response?.description ?? error?.message ?? '');
}

async function download(url, userAgent, limit) {
    const res = await fetch(url, {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > limit) throw new Error('файл слишком большой');
    return buffer;
}

/**
 * Отправляет пост Danbooru в чат. Сначала отдаёт Telegram ссылку,
 * если Telegram не смог её скачать — скачивает сам и загружает файлом.
 *
 * @param {object} options
 * @param {string} [options.query] — строка "Запрос: ..." в подписи
 * @param {string} [options.header] — строка в начале подписи (HTML)
 * @param {object} [options.extra] — доп. параметры Telegram (reply_markup и т.п.)
 * @returns {Promise<object|null>} отправленное сообщение или null
 */
export async function sendPost(telegram, chatId, post, { client, userAgent, query, header, extra = {} }) {
    const media = pickMedia(post, client.baseUrl);
    if (!media) return null;

    const method = METHODS[media.type];
    const options = {
        caption: buildCaption(post, { postUrl: client.postUrl(post.id), query, header }),
        parse_mode: 'HTML',
        ...extra
    };

    try {
        return await telegram[method](chatId, media.url, options);
    } catch (error) {
        if (isFatalTelegramError(error)) throw error;
        console.warn(`⚠️ Telegram не принял ссылку (пост ${post.id}): ${error.message}`);
    }

    try {
        const source = await download(media.url, userAgent, MAX_UPLOAD[media.type]);
        return await telegram[method](chatId, { source, filename: `danbooru_${post.id}.${post.file_ext}` }, options);
    } catch (error) {
        if (isFatalTelegramError(error)) throw error;
        console.warn(`⚠️ Не удалось отправить пост ${post.id}: ${error.message}`);
        return null;
    }
}

/**
 * Отправляет альбом (2–10 картинок). Подпись с полной информацией — у первой,
 * у остальных — короткая.
 * @returns {Promise<Array<{ message: object, post: object }>>}
 */
export async function sendAlbum(telegram, chatId, posts, { client, userAgent, header }) {
    const items = posts
        .map(post => ({ post, media: pickMedia(post, client.baseUrl) }))
        .filter(item => item.media && (item.media.type === 'photo' || item.media.type === 'video'))
        .slice(0, 10);
    if (items.length < 2) return [];

    const build = (sources) => items.map(({ post, media }, index) => ({
        type: media.type,
        media: sources[index],
        parse_mode: 'HTML',
        caption: index === 0
            ? buildCaption(post, { postUrl: client.postUrl(post.id), header, maxGeneralTags: 10 })
            : buildCaption(post, { postUrl: client.postUrl(post.id), compact: true })
    }));

    let messages;
    try {
        messages = await telegram.sendMediaGroup(chatId, build(items.map(i => i.media.url)));
    } catch (error) {
        if (isFatalTelegramError(error)) throw error;
        console.warn(`⚠️ Альбом по ссылкам не ушёл: ${error.message} — загружаю файлы`);
        const sources = [];
        for (const { post, media } of items) {
            sources.push({
                source: await download(media.url, userAgent, MAX_UPLOAD[media.type]),
                filename: `danbooru_${post.id}.${post.file_ext}`
            });
        }
        messages = await telegram.sendMediaGroup(chatId, build(sources));
    }
    return messages.map((message, index) => ({ message, post: items[index].post }));
}
