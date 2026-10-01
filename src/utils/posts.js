import { RATINGS } from './ratings.js';

const PHOTO_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MAX_URL_FILE_SIZE = 20 * 1024 * 1024; // Telegram скачивает по URL файлы до 20 МБ
// Ограничения Telegram для фото по ссылке: до 5 МБ, ширина+высота ≤ 10000, соотношение сторон ≤ 20
const MAX_PHOTO_URL_SIZE = 5 * 1024 * 1024;

function absolute(url, baseUrl) {
    if (!url) return null;
    return url.startsWith('http') ? url : new URL(url, baseUrl).toString();
}

/** Ссылка на оригинал в полном разрешении (или null, если скрыт). */
export function originalUrl(post, baseUrl) {
    return absolute(post.file_url, baseUrl);
}

/** Можно ли отправить оригинал как фото (по ограничениям Telegram). */
export function originalFitsPhoto(post) {
    const ext = post.file_ext?.toLowerCase();
    const w = post.image_width ?? 0;
    const h = post.image_height ?? 0;
    return (ext === 'jpg' || ext === 'jpeg' || ext === 'png')
        && Boolean(post.file_url)
        && (post.file_size ?? Infinity) <= MAX_PHOTO_URL_SIZE
        && w > 0 && h > 0
        && w + h <= 10000
        && Math.max(w, h) / Math.min(w, h) <= 20;
}

/**
 * Выбирает, как отправить пост в Telegram.
 * Для фото берём оригинал в полном качестве, если Telegram его примет,
 * иначе — уменьшенную копию (large_file_url). fallbackUrl — запасная ссылка.
 * @returns {{ type: 'photo'|'animation'|'video', url: string, fallbackUrl?: string } | null}
 */
export function pickMedia(post, baseUrl) {
    const ext = post.file_ext?.toLowerCase();

    if (PHOTO_EXT.has(ext)) {
        const sample = absolute(post.large_file_url || post.file_url, baseUrl);
        if (!sample) return null;
        if (originalFitsPhoto(post)) {
            const original = originalUrl(post, baseUrl);
            return { type: 'photo', url: original, ...(original !== sample ? { fallbackUrl: sample } : {}) };
        }
        return { type: 'photo', url: sample };
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
 * Метатеги, которые Danbooru не считает в лимит тегов
 * (UNLIMITED_METATAGS в app/logical/post_query.rb).
 */
export const FREE_METATAGS = new Set([
    'status', 'rating', 'limit', 'is', 'id', 'date', 'age', 'filesize', 'filetype', 'parent', 'child',
    'md5', 'width', 'height', 'duration', 'mpixels', 'ratio', 'score', 'upvote', 'downvotes',
    'favcount', 'embedded', 'tagcount', 'pixiv_id', 'pixiv'
]);

export function isFreeMetatag(name) {
    return FREE_METATAGS.has(name.split(':')[0]);
}

/**
 * Делит теги на те, что уйдут в запрос к Danbooru (с учётом лимита),
 * и те, что бот проверит сам.
 *
 * @param {number} tagLimit — сколько «платных» тегов разрешено
 * @param {object} [options]
 * @param {boolean} [options.random] — random=true превращается в метатег random:N, он тоже занимает слот
 */
export function buildQuery(tags, rating, tagLimit, { random = false } = {}) {
    const metas = tags.filter(t => t.meta);
    // Самые редкие теги отправляем на сервер — так выборка получается точнее.
    const includes = tags.filter(t => !t.meta && !t.negated).sort((a, b) => a.postCount - b.postCount);
    const excludes = tags.filter(t => !t.meta && t.negated);

    const serverTags = [];
    const clientInclude = [];
    const clientExclude = [];
    let used = random ? 1 : 0;

    for (const meta of metas) {
        serverTags.push(`${meta.negated ? '-' : ''}${meta.name}`);
        if (!isFreeMetatag(meta.name)) used++;
    }
    for (const tag of includes) {
        if (used < tagLimit) {
            serverTags.push(tag.name);
            used++;
        } else {
            clientInclude.push(tag.name);
        }
    }
    for (const tag of excludes) {
        if (used < tagLimit) {
            serverTags.push(`-${tag.name}`);
            used++;
        } else {
            clientExclude.push(tag.name);
        }
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
