import { pickMedia } from '../utils/posts.js';
import { buildCaption } from '../utils/format.js';

const MAX_UPLOAD = { photo: 10 * 1024 * 1024, animation: 50 * 1024 * 1024, video: 50 * 1024 * 1024 };

const METHODS = {
    photo: 'sendPhoto',
    animation: 'sendAnimation',
    video: 'sendVideo'
};

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
 * @returns {Promise<boolean>} удалось ли отправить
 */
export async function sendPost(telegram, chatId, post, { client, userAgent, query, extra = {} }) {
    const media = pickMedia(post, client.baseUrl);
    if (!media) return false;

    const method = METHODS[media.type];
    const options = {
        caption: buildCaption(post, { postUrl: client.postUrl(post.id), query }),
        parse_mode: 'HTML',
        ...extra
    };

    try {
        await telegram[method](chatId, media.url, options);
        return true;
    } catch (error) {
        if (error?.response?.error_code === 429) throw error;
        console.warn(`⚠️ Telegram не принял ссылку (пост ${post.id}): ${error.message}`);
    }

    try {
        const source = await download(media.url, userAgent, MAX_UPLOAD[media.type]);
        await telegram[method](chatId, { source, filename: `danbooru_${post.id}.${post.file_ext}` }, options);
        return true;
    } catch (error) {
        if (error?.response?.error_code === 429) throw error;
        console.warn(`⚠️ Не удалось отправить пост ${post.id}: ${error.message}`);
        return false;
    }
}
