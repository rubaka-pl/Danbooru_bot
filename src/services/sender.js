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
 * @param {string} [options.caption] — своя подпись вместо стандартной
 * @param {object} [options.extra] — доп. параметры Telegram (reply_markup и т.п.)
 * @param {Function} [options.tagLink] — теги в подписи станут ссылками (см. utils/tagLinks.js)
 * @returns {Promise<object|null>} отправленное сообщение или null
 */
export async function sendPost(telegram, chatId, post, { client, userAgent, query, header, caption, tagLink, extra = {} }) {
    const media = pickMedia(post, client.baseUrl);
    if (!media) return null;

    const method = METHODS[media.type];
    const options = {
        caption: caption ?? buildCaption(post, { postUrl: client.postUrl(post.id), query, header, tagLink, siteName: client.name }),
        parse_mode: 'HTML',
        ...extra
    };

    // 1) оригинал по ссылке, 2) уменьшенная копия по ссылке, 3) загрузка файлом
    for (const url of [media.url, media.fallbackUrl].filter(Boolean)) {
        try {
            return await telegram[method](chatId, url, options);
        } catch (error) {
            if (isFatalTelegramError(error)) throw error;
            console.warn(`⚠️ Telegram не принял ссылку (пост ${post.id}): ${error.message}`);
        }
    }

    try {
        const source = await download(media.fallbackUrl ?? media.url, userAgent, MAX_UPLOAD[media.type]);
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
 * @param {object} [options.extra] — доп. параметры Telegram (например, disable_notification)
 * @returns {Promise<Array<{ message: object, post: object }>>}
 */
export async function sendAlbum(telegram, chatId, posts, { client, userAgent, header, tagLink, extra }) {
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
            ? buildCaption(post, { postUrl: client.postUrl(post.id), header, maxGeneralTags: 10, tagLink, siteName: client.name })
            : buildCaption(post, { postUrl: client.postUrl(post.id), compact: true, tagLink })
    }));

    // 1) оригиналы по ссылкам, 2) уменьшенные копии, 3) загрузка файлами
    const attempts = [
        items.map(i => i.media.url),
        items.some(i => i.media.fallbackUrl) ? items.map(i => i.media.fallbackUrl ?? i.media.url) : null
    ].filter(Boolean);

    let messages;
    for (const urls of attempts) {
        try {
            messages = await telegram.sendMediaGroup(chatId, build(urls), extra);
            break;
        } catch (error) {
            if (isFatalTelegramError(error)) throw error;
            console.warn(`⚠️ Альбом по ссылкам не ушёл: ${error.message}`);
        }
    }
    if (!messages) {
        const sources = [];
        for (const { post, media } of items) {
            sources.push({
                source: await download(media.fallbackUrl ?? media.url, userAgent, MAX_UPLOAD[media.type]),
                filename: `danbooru_${post.id}.${post.file_ext}`
            });
        }
        messages = await telegram.sendMediaGroup(chatId, build(sources), extra);
    }
    return messages.map((message, index) => ({ message, post: items[index].post }));
}

const MAX_DOCUMENT_BY_URL = 20 * 1024 * 1024;
const MAX_DOCUMENT_UPLOAD = 50 * 1024 * 1024;

const formatSize = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

/**
 * Отправляет оригинал в полном разрешении файлом (без сжатия Telegram).
 * @returns {Promise<'sent'|'link'|'unavailable'>}
 */
export async function sendOriginal(telegram, chatId, post, { client, userAgent, header }) {
    const url = post.file_url
        ? (post.file_url.startsWith('http') ? post.file_url : new URL(post.file_url, client.baseUrl).toString())
        : null;
    if (!url) return 'unavailable';

    const size = post.file_size ?? 0;
    const caption = [header, `📥 Оригинал · ${post.image_width ?? '?'}×${post.image_height ?? '?'} · ${formatSize(size)}`, client.postUrl(post.id)]
        .filter(Boolean).join('\n');
    const filename = `danbooru_${post.id}.${post.file_ext}`;
    const sendLink = async () => {
        await telegram.sendMessage(chatId, `📥 Файл слишком большой для Telegram (${formatSize(size)}). Скачать: ${url}`);
        return 'link';
    };

    if (size > MAX_DOCUMENT_UPLOAD) return sendLink();

    if (size <= MAX_DOCUMENT_BY_URL) {
        try {
            await telegram.sendDocument(chatId, url, { caption });
            return 'sent';
        } catch (error) {
            if (isFatalTelegramError(error)) throw error;
        }
    }

    try {
        const source = await download(url, userAgent, MAX_DOCUMENT_UPLOAD);
        await telegram.sendDocument(chatId, { source, filename }, { caption });
        return 'sent';
    } catch (error) {
        if (isFatalTelegramError(error)) throw error;
        return sendLink();
    }
}
