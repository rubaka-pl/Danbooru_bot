export class DanbooruError extends Error {
    constructor(message, status, body = null) {
        super(message);
        this.name = 'DanbooruError';
        this.status = status;
        this.body = body;
    }

    get isRateLimit() {
        return this.status === 429;
    }

    // Danbooru отвечает 422, если в запросе слишком много тегов.
    get isTagLimit() {
        return this.status === 422 && /tag/i.test(this.message);
    }
}

/** Ответ IQDB → [{ post, score }] */
function normalizeIqdb(body) {
    if (!Array.isArray(body)) return [];
    return body
        .map(item => ({ post: item.post ?? null, postId: item.post_id ?? item.post?.id, score: Number(item.score ?? item.similarity ?? 0) }))
        .filter(item => item.postId);
}

/**
 * Тонкая обёртка над JSON API Danbooru.
 */
export function createDanbooruClient({ baseUrl, login, apiKey, timeout = 15000, userAgent, fetchImpl = fetch }) {
    async function request(pathname, params = {}, { method = 'GET', body: requestBody } = {}) {
        const url = new URL(pathname, baseUrl);
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
        }
        if (login && apiKey) {
            url.searchParams.set('login', login);
            url.searchParams.set('api_key', apiKey);
        }

        let res;
        try {
            res = await fetchImpl(url, {
                method,
                body: requestBody,
                headers: { 'User-Agent': userAgent, Accept: 'application/json' },
                signal: AbortSignal.timeout(timeout)
            });
        } catch (error) {
            throw new DanbooruError(`Danbooru недоступен: ${error.message}`, 0);
        }

        let body = null;
        try {
            body = await res.json();
        } catch {
            // не JSON (например, страница Cloudflare)
        }

        if (!res.ok) {
            throw new DanbooruError(body?.message || `HTTP ${res.status}`, res.status, body);
        }
        return body;
    }

    return {
        baseUrl,

        async post(id) {
            return request(`/posts/${Number(id)}.json`);
        },

        /** Посты по списку id (порядок не гарантирован). */
        async postsByIds(ids) {
            if (!ids.length) return [];
            const body = await request('/posts.json', { tags: `id:${ids.map(Number).join(',')}`, limit: ids.length });
            return Array.isArray(body) ? body : [];
        },

        /** Похожие картинки (IQDB) по id поста. */
        async similarToPost(postId, limit = 10) {
            const body = await request('/iqdb_queries.json', {
                'search[post_id]': Number(postId),
                'search[limit]': limit,
                post_id: Number(postId),
                limit
            });
            return normalizeIqdb(body);
        },

        /** Поиск по картинке (IQDB) — загрузка файла. */
        async similarToFile(buffer, filename = 'image.jpg', limit = 10) {
            const form = new FormData();
            form.append('search[file]', new Blob([buffer]), filename);
            form.append('search[limit]', String(limit));
            const body = await request('/iqdb_queries.json', {}, { method: 'POST', body: form });
            return normalizeIqdb(body);
        },

        async posts({ tags = [], limit = 20, random = false, page } = {}) {
            const body = await request('/posts.json', {
                tags: tags.join(' '),
                limit,
                random: random ? 'true' : undefined,
                page
            });
            if (!Array.isArray(body)) throw new DanbooruError('Некорректный ответ API', 200, body);
            return body;
        },

        // Популярное за день/неделю/месяц
        async popular({ scale = 'day', date, limit = 100 } = {}) {
            const body = await request('/explore/posts/popular.json', { scale, date, limit });
            if (!Array.isArray(body)) throw new DanbooruError('Некорректный ответ API', 200, body);
            return body;
        },

        async tagByName(name) {
            const body = await request('/tags.json', { 'search[name]': name, limit: 1 });
            return Array.isArray(body) ? body[0] ?? null : null;
        },

        async aliasOf(name) {
            const body = await request('/tag_aliases.json', {
                'search[antecedent_name]': name,
                'search[status]': 'active',
                limit: 1
            });
            return Array.isArray(body) ? body[0]?.consequent_name ?? null : null;
        },

        async autocomplete(query) {
            const body = await request('/autocomplete.json', {
                'search[query]': query,
                'search[type]': 'tag_query',
                limit: 10
            });
            return Array.isArray(body) ? body : [];
        },

        async tagsMatching(pattern) {
            const body = await request('/tags.json', {
                'search[name_matches]': pattern,
                'search[hide_empty]': 'true',
                'search[order]': 'count',
                limit: 10
            });
            return Array.isArray(body) ? body : [];
        },

        /** Теги, похожие по написанию (опечатки): "hatsue_miku" → "hatsune_miku" */
        async tagsFuzzy(name, limit = 5) {
            const body = await request('/tags.json', {
                'search[fuzzy_name_matches]': name,
                'search[hide_empty]': 'true',
                'search[order]': 'count',
                limit
            });
            return Array.isArray(body) ? body : [];
        },

        /** Вики-страница тега или null */
        async wiki(title) {
            try {
                return await request(`/wiki_pages/${encodeURIComponent(title)}.json`);
            } catch (error) {
                if (error.status === 404) return null;
                throw error;
            }
        },

        /** Связанные теги → [{ name, category, postCount }] */
        async relatedTags(query, { category, limit = 15 } = {}) {
            const body = await request('/related_tag.json', { query, category, limit });
            const list = Array.isArray(body?.related_tags) ? body.related_tags : [];
            return list
                .map(item => item.tag ?? item)
                .filter(tag => tag?.name && tag.name !== query)
                .map(tag => ({ name: tag.name, category: tag.category ?? 0, postCount: tag.post_count ?? 0 }));
        },

        postUrl(id) {
            return new URL(`/posts/${id}`, baseUrl).toString();
        }
    };
}
