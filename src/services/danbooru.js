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

/**
 * Тонкая обёртка над JSON API Danbooru.
 */
export function createDanbooruClient({ baseUrl, login, apiKey, timeout = 15000, userAgent, fetchImpl = fetch }) {
    async function request(pathname, params = {}) {
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
        async popular({ scale = 'day', date } = {}) {
            const body = await request('/explore/posts/popular.json', { scale, date });
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

        postUrl(id) {
            return new URL(`/posts/${id}`, baseUrl).toString();
        }
    };
}
