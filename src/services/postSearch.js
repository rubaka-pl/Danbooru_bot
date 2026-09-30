import { buildQuery, matchesClientFilter, pickMedia } from '../utils/posts.js';

/**
 * Ищет посты по тегам. Если Danbooru ругается на лимит тегов,
 * лишние теги (и рейтинг) переносятся в фильтр на стороне бота.
 *
 * @param {object} client — клиент Danbooru
 * @param {object} options
 * @param {Array} options.tags — разрешённые теги ({ name, postCount, negated, meta })
 * @param {string} options.rating — ключ из RATINGS
 * @param {number} options.count — сколько постов нужно
 * @param {(post) => boolean} [options.skip] — пропустить пост (например, уже отправленный)
 * @param {number} options.tagLimit
 * @param {boolean} [options.random=true] — false: сначала новые
 * @param {number} [options.page]
 * @param {number} [options.limit] — сколько постов запросить у API
 */
export async function findPosts(client, options) {
    const { tags, count, random = true } = options;
    const posts = await fetchFiltered(client, options, random);

    // В случайном режиме один слот лимита занимает random:, поэтому часть тегов
    // проверяется на стороне бота. Если нашлось мало — добиваем свежими постами,
    // где на сервер уходит на один тег больше.
    const includes = tags.filter(t => !t.meta && !t.negated).length;
    if (random && posts.length < count && includes >= 2) {
        const extra = await fetchFiltered(client, options, false).catch(() => []);
        const seen = new Set(posts.map(p => p.id));
        posts.push(...extra.filter(p => !seen.has(p.id)));
    }
    return posts;
}

async function fetchFiltered(client, { tags, rating, count, skip = () => false, tagLimit = 2, page, limit: fetchLimit }, random) {
    let limit = tagLimit;
    let ratingOnServer = true;

    for (let attempt = 0; attempt < 4; attempt++) {
        const query = buildQuery(tags, rating, limit, { random });
        const serverTags = [...query.serverTags];
        if (ratingOnServer && query.ratingCode) serverTags.push(`rating:${query.ratingCode}`);

        const filtered = query.clientInclude.length || query.clientExclude.length || !ratingOnServer;
        const clientFilter = ratingOnServer ? { ...query, ratingCode: null } : query;

        let posts;
        try {
            posts = await client.posts({
                tags: serverTags,
                limit: fetchLimit ?? (filtered ? 200 : Math.min(count * 4 + 10, 100)),
                random,
                page
            });
        } catch (error) {
            if (!error?.isTagLimit) throw error;
            if (ratingOnServer && query.ratingCode) {
                ratingOnServer = false;
            } else if (limit > 1) {
                limit--;
            } else {
                throw error;
            }
            continue;
        }

        return posts
            .filter(post => !post.is_deleted && !post.is_banned)
            .filter(post => matchesClientFilter(post, clientFilter))
            .filter(post => pickMedia(post, client.baseUrl))
            .filter(post => !skip(post));
    }
    return [];
}
