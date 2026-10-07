import { DanbooruError } from './danbooru.js';

/*
 * Другие борды: Gelbooru и Moebooru (Konachan, Yande.re). Ключи не нужны.
 * Посты приводятся к формату Danbooru, чтобы поиск,
 * фильтры и отправка работали без изменений. Категорий тегов (автор/персонаж)
 * у этих API нет — все теги идут в общий список.
 *
 * Клиент умеет только posts / post / postUrl. Подсказки по тегам, вики,
 * похожие (IQDB), популярное — по-прежнему с Danbooru.
 */

// Рейтинг Danbooru (g/s/e) → значение метатега rating: на борде
const GELBOORU_RATINGS = { g: 'general', s: 'sensitive', e: 'explicit' };
const MOEBOORU_RATINGS = { g: 's', s: 'q', e: 'e' };

// Рейтинг борды → код Danbooru (q считается 18+, как и e)
const TO_DANBOORU_RATING = {
    general: 'g', safe: 'g', sensitive: 's', questionable: 'q', explicit: 'e',
    s: 'g', q: 'q', e: 'e'
};

export const BOORUS = {
    gelbooru: { name: 'Gelbooru', kind: 'gelbooru', baseUrl: 'https://gelbooru.com', ratings: GELBOORU_RATINGS, tagLimit: 10 },
    konachan: { name: 'Konachan', kind: 'moebooru', baseUrl: 'https://konachan.com', ratings: MOEBOORU_RATINGS, tagLimit: 6 },
    yandere: { name: 'Yande.re', kind: 'moebooru', baseUrl: 'https://yande.re', ratings: MOEBOORU_RATINGS, tagLimit: 6 }
};

const extOf = (name = '') => name.split('?')[0].split('.').pop()?.toLowerCase() ?? '';

function toIso(value) {
    if (value == null || value === '') return null;
    const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Danbooru-метатеги → синтаксис борды: rating:g → rating:general, random → sort/order. */
export function translateTags(tags, site, { random }) {
    const out = [];
    for (const tag of tags) {
        const rating = /^(-?)rating:([gse])$/.exec(tag);
        if (rating) {
            out.push(`${rating[1]}rating:${site.ratings[rating[2]]}`);
            continue;
        }
        out.push(tag);
    }
    if (random) out.push(site.kind === 'moebooru' ? 'order:random' : 'sort:random');
    return out;
}

/** Пост Gelbooru → формат Danbooru. */
export function normalizeGelbooruPost(raw, site) {
    const fileUrl = raw.file_url || null;
    const ext = extOf(fileUrl || raw.image || '');
    const sampleUrl = raw.sample_url || null;
    const previewUrl = raw.preview_url || null;
    const tags = String(raw.tags ?? '').trim().split(/\s+/).filter(Boolean).join(' ');
    return {
        id: Number(raw.id),
        md5: raw.md5 ?? `${site.name}_${raw.id}`,
        rating: TO_DANBOORU_RATING[raw.rating] ?? 'q',
        score: Number(raw.score ?? 0),
        file_ext: ext,
        file_url: fileUrl,
        large_file_url: sampleUrl || fileUrl,
        preview_file_url: previewUrl,
        // Размер API не отдаёт: 0 — «пробуем оригинал, Telegram откажет — возьмём уменьшенную копию»
        file_size: Number(raw.file_size ?? 0),
        image_width: Number(raw.width ?? 0),
        image_height: Number(raw.height ?? 0),
        tag_string: tags,
        tag_string_general: tags,
        tag_string_artist: '',
        tag_string_character: '',
        tag_string_copyright: '',
        created_at: toIso(raw.created_at),
        source: raw.source ?? ''
    };
}

/** Пост Konachan / Yande.re → формат Danbooru. */
export function normalizeMoebooruPost(raw, site) {
    const tags = String(raw.tags ?? '').trim().split(/\s+/).filter(Boolean).join(' ');
    const fileUrl = raw.file_url ?? null;
    return {
        id: Number(raw.id),
        md5: raw.md5 ?? `${site.name}_${raw.id}`,
        rating: TO_DANBOORU_RATING[raw.rating] ?? 'q',
        score: Number(raw.score ?? 0),
        file_ext: raw.file_ext ?? extOf(fileUrl ?? ''),
        file_url: fileUrl,
        // jpeg_url — полноразмерный JPEG вместо тяжёлого PNG, sample_url — уменьшенная копия
        large_file_url: raw.sample_url ?? raw.jpeg_url ?? fileUrl,
        preview_file_url: raw.preview_url ?? null,
        file_size: Number(raw.file_size ?? 0),
        image_width: Number(raw.width ?? 0),
        image_height: Number(raw.height ?? 0),
        tag_string: tags,
        tag_string_general: tags,
        tag_string_artist: '',
        tag_string_character: '',
        tag_string_copyright: '',
        created_at: toIso(raw.created_at),
        source: raw.source ?? ''
    };
}

/**
 * Клиент другой борды с тем же интерфейсом поиска, что у Danbooru.
 * @param {string} id — ключ из BOORUS
 */
export function createBooruClient(id, { userAgent, timeout = 15000, fetchImpl } = {}) {
    const site = BOORUS[id];
    if (!site) throw new Error(`Неизвестная борда: ${id}`);
    const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));

    async function request(url) {
        let res;
        try {
            res = await doFetch(url, {
                headers: { 'User-Agent': userAgent, Accept: 'application/json' },
                signal: AbortSignal.timeout(timeout)
            });
        } catch (error) {
            throw new DanbooruError(`${site.name} недоступен: ${error.message}`, 0);
        }
        const text = await res.text();
        if (!res.ok) {
            throw new DanbooruError(`${site.name}: HTTP ${res.status}`, res.status);
        }
        if (!text.trim()) return [];
        try {
            return JSON.parse(text);
        } catch {
            throw new DanbooruError(`${site.name}: некорректный ответ API`, 200);
        }
    }

    async function gelbooruPosts(params) {
        const url = new URL('/index.php', site.baseUrl);
        url.search = new URLSearchParams({ page: 'dapi', s: 'post', q: 'index', json: '1', ...params }).toString();
        const body = await request(url);
        // Gelbooru: { post: [...] }; без результатов поля post нет
        const list = Array.isArray(body) ? body : Array.isArray(body?.post) ? body.post : [];
        return list.map(raw => normalizeGelbooruPost(raw, site));
    }

    async function moebooruPosts(params) {
        const url = new URL('/post.json', site.baseUrl);
        url.search = new URLSearchParams(params).toString();
        const body = await request(url);
        return (Array.isArray(body) ? body : []).map(raw => normalizeMoebooruPost(raw, site));
    }

    const fetchPosts = site.kind === 'moebooru' ? moebooruPosts : gelbooruPosts;

    return {
        id,
        name: site.name,
        baseUrl: site.baseUrl,
        tagLimit: site.tagLimit,

        async posts({ tags = [], limit = 20, random = false, page } = {}) {
            const query = translateTags(tags, site, { random }).join(' ');
            const capped = Math.min(limit, 100);
            if (site.kind === 'moebooru') {
                return fetchPosts({ tags: query, limit: String(capped), ...(page ? { page: String(page) } : {}) });
            }
            // У Gelbooru страницы с нуля (pid)
            return fetchPosts({ tags: query, limit: String(capped), ...(page ? { pid: String(page - 1) } : {}) });
        },

        async post(postId) {
            const [post] = site.kind === 'moebooru'
                ? await fetchPosts({ tags: `id:${Number(postId)}`, limit: '1' })
                : await fetchPosts({ id: String(Number(postId)) });
            if (!post) throw new DanbooruError(`${site.name}: пост ${postId} не найден`, 404);
            return post;
        },

        postUrl(postId) {
            return site.kind === 'moebooru'
                ? `${site.baseUrl}/post/show/${postId}`
                : `${site.baseUrl}/index.php?page=post&s=view&id=${postId}`;
        }
    };
}

/** Все клиенты: { danbooru, gelbooru, konachan, yandere }. Danbooru — основной. */
export function createBooruClients(danbooruClient, { userAgent } = {}) {
    const clients = { danbooru: Object.assign(danbooruClient, { id: 'danbooru', name: 'Danbooru' }) };
    for (const id of Object.keys(BOORUS)) clients[id] = createBooruClient(id, { userAgent });
    return clients;
}
