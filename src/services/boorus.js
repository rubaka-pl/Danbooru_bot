import { DanbooruError } from './danbooru.js';

/*
 * Другие борды: Gelbooru-подобные (Gelbooru, Safebooru, Rule34) и Moebooru
 * (Konachan, Yande.re). Посты приводятся к формату Danbooru, чтобы поиск,
 * фильтры и отправка работали без изменений. Категорий тегов (автор/персонаж)
 * у этих API нет — все теги идут в общий список.
 *
 * Клиент умеет только posts / post / postUrl. Подсказки по тегам, вики,
 * похожие (IQDB), популярное — по-прежнему с Danbooru.
 */

// Рейтинг Danbooru (g/s/e) → значение метатега rating: на борде
const GELBOORU_RATINGS = { g: 'general', s: 'sensitive', e: 'explicit' };
const RULE34_RATINGS = { g: 'safe', s: 'questionable', e: 'explicit' };
const MOEBOORU_RATINGS = { g: 's', s: 'q', e: 'e' };

// Рейтинг борды → код Danbooru (q считается 18+, как и e)
const TO_DANBOORU_RATING = {
    general: 'g', safe: 'g', sensitive: 's', questionable: 'q', explicit: 'e',
    s: 'g', q: 'q', e: 'e'
};

export const BOORUS = {
    gelbooru: { name: 'Gelbooru', kind: 'gelbooru', baseUrl: 'https://gelbooru.com', ratings: GELBOORU_RATINGS, tagLimit: 10 },
    safebooru: { name: 'Safebooru', kind: 'gelbooru', baseUrl: 'https://safebooru.org', ratings: null, tagLimit: 10, safeOnly: true },
    rule34: { name: 'Rule34', kind: 'gelbooru', baseUrl: 'https://api.rule34.xxx', siteUrl: 'https://rule34.xxx', ratings: RULE34_RATINGS, tagLimit: 10, needsKey: true },
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
            // Safebooru — только safe, рейтинг не нужен
            if (site.ratings) out.push(`${rating[1]}rating:${site.ratings[rating[2]]}`);
            continue;
        }
        out.push(tag);
    }
    if (random) out.push(site.kind === 'moebooru' ? 'order:random' : 'sort:random');
    return out;
}

/** Пост Gelbooru / Safebooru / Rule34 → формат Danbooru. */
export function normalizeGelbooruPost(raw, site) {
    const base = site.siteUrl ?? site.baseUrl;
    const image = raw.image ?? '';
    const ext = extOf(raw.file_url || image);
    const dir = raw.directory;
    // У Safebooru ссылок в ответе нет — собираем из directory/image
    const fileUrl = raw.file_url || (dir && image ? `${base}/images/${dir}/${image}` : null);
    const sampleUrl = raw.sample_url
        || (raw.sample && dir && image ? `${base}/samples/${dir}/sample_${image.replace(/\.\w+$/, '.jpg')}` : null);
    const previewUrl = raw.preview_url
        || (dir && image ? `${base}/thumbnails/${dir}/thumbnail_${image.replace(/\.\w+$/, '.jpg')}` : null);
    const tags = String(raw.tags ?? '').trim().split(/\s+/).filter(Boolean).join(' ');
    return {
        id: Number(raw.id),
        md5: raw.md5 ?? raw.hash ?? `${site.name}_${raw.id}`,
        rating: site.safeOnly ? 'g' : (TO_DANBOORU_RATING[raw.rating] ?? 'q'),
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
        created_at: toIso(raw.created_at) ?? toIso(Number(raw.change)),
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
 * @param {object} options
 * @param {{ apiKey?: string, userId?: string }} [options.credentials]
 */
export function createBooruClient(id, { userAgent, timeout = 15000, credentials = {}, fetchImpl } = {}) {
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
            const hint = res.status === 401 || res.status === 403
                ? ` — ${site.name} требует API-ключ (см. docs/SETUP.md)`
                : '';
            throw new DanbooruError(`${site.name}: HTTP ${res.status}${hint}`, res.status);
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
        if (credentials.apiKey && credentials.userId) {
            url.searchParams.set('api_key', credentials.apiKey);
            url.searchParams.set('user_id', credentials.userId);
        }
        const body = await request(url);
        // Gelbooru: { post: [...] }, Safebooru/Rule34: [...]
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
        baseUrl: site.siteUrl ?? site.baseUrl,
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
                : `${site.siteUrl ?? site.baseUrl}/index.php?page=post&s=view&id=${postId}`;
        }
    };
}

/**
 * Все клиенты: { danbooru, gelbooru, ... }. Борды, которым нужен ключ, без ключа не подключаются.
 */
export function createBooruClients(danbooruClient, { userAgent, keys = {} } = {}) {
    const clients = { danbooru: Object.assign(danbooruClient, { id: 'danbooru', name: 'Danbooru' }) };
    for (const id of Object.keys(BOORUS)) {
        const credentials = keys[id] ?? {};
        if (BOORUS[id].needsKey && !(credentials.apiKey && credentials.userId)) continue;
        clients[id] = createBooruClient(id, { userAgent, credentials });
    }
    return clients;
}
