import { RATINGS } from './ratings.js';

const PHOTO_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MAX_URL_FILE_SIZE = 20 * 1024 * 1024; // Telegram скачивает по URL файлы до 20 МБ

function absolute(url, baseUrl) {
    if (!url) return null;
    return url.startsWith('http') ? url : new URL(url, baseUrl).toString();
}

/**
 * Выбирает, как отправить пост в Telegram.
 * @returns {{ type: 'photo'|'animation'|'video', url: string } | null}
 */
export function pickMedia(post, baseUrl) {
    const ext = post.file_ext?.toLowerCase();

    if (PHOTO_EXT.has(ext)) {
        // large_file_url — уменьшенная копия (~850px), Telegram её всегда принимает
        const url = absolute(post.large_file_url || post.file_url, baseUrl);
        return url ? { type: 'photo', url } : null;
    }
    if (ext === 'gif' && post.file_size <= MAX_URL_FILE_SIZE) {
        const url = absolute(post.file_url, baseUrl);
        return url ? { type: 'animation', url } : null;
    }
    if (ext === 'mp4' && post.file_size <= MAX_URL_FILE_SIZE) {
        const url = absolute(post.file_url, baseUrl);
        return url ? { type: 'video', url } : null;
    }
    // webm, zip (ugoira), swf и т.п. Telegram нормально не показывает
    return null;
}

/**
 * Делит теги на те, что уйдут в запрос к Danbooru (с учётом лимита),
 * и те, что бот проверит сам.
 */
export function buildQuery(tags, rating, tagLimit) {
    const metas = tags.filter(t => t.meta);
    // Самые редкие теги отправляем на сервер — так выборка получается точнее.
    const includes = tags.filter(t => !t.meta && !t.negated).sort((a, b) => a.postCount - b.postCount);
    const excludes = tags.filter(t => !t.meta && t.negated);

    const serverTags = [];
    const clientInclude = [];
    const clientExclude = [];

    for (const meta of metas) serverTags.push(`${meta.negated ? '-' : ''}${meta.name}`);
    for (const tag of includes) {
        if (serverTags.length < tagLimit) serverTags.push(tag.name);
        else clientInclude.push(tag.name);
    }
    for (const tag of excludes) {
        if (serverTags.length < tagLimit) serverTags.push(`-${tag.name}`);
        else clientExclude.push(tag.name);
    }

    const ratingCode = RATINGS[rating]?.code ?? null;
    return { serverTags, clientInclude, clientExclude, ratingCode };
}

export function matchesClientFilter(post, { clientInclude = [], clientExclude = [], ratingCode = null }) {
    if (ratingCode && post.rating !== ratingCode) return false;
    if (!clientInclude.length && !clientExclude.length) return true;
    const tagSet = new Set((post.tag_string || '').split(' '));
    return clientInclude.every(t => tagSet.has(t)) && !clientExclude.some(t => tagSet.has(t));
}
