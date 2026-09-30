/*
 * Статистика реакций в канале: какие персонажи/тайтлы/авторы нравятся
 * подписчикам больше всего. Автопост использует её, чтобы подстраиваться.
 */

const MSG_TTL = 30 * 24 * 60 * 60; // реакции отслеживаем 30 дней
const STATS_KEY = 'ch:tagstats';
const MAX_TRACKED_TAGS = 1000;

const splitTags = (value) => (value || '').split(' ').filter(Boolean);

/** Теги поста, по которым считаем статистику. */
export function statTags(post) {
    return [
        ...splitTags(post.tag_string_character),
        ...splitTags(post.tag_string_copyright).filter(t => t !== 'original'),
        ...splitTags(post.tag_string_artist)
    ].slice(0, 12);
}

/** Сумма реакций из апдейта message_reaction_count. */
export function totalReactions(reactions = []) {
    return reactions.reduce((sum, r) => sum + (r.total_count ?? 0), 0);
}

/**
 * Рейтинг тегов: среднее число реакций с поправкой на малое число постов.
 * @returns {Array<{ tag, posts, reactions, score }>}
 */
export function rankTags(stats, { minPosts = 2 } = {}) {
    const entries = Object.entries(stats);
    const totalPosts = entries.reduce((s, [, [p]]) => s + p, 0);
    const totalReacts = entries.reduce((s, [, [, r]]) => s + r, 0);
    const avg = totalPosts ? totalReacts / totalPosts : 0;
    const prior = 3; // «виртуальные» посты со средним результатом

    return entries
        .filter(([, [posts]]) => posts >= minPosts)
        .map(([tag, [posts, reactions]]) => ({
            tag,
            posts,
            reactions,
            score: (reactions + avg * prior) / (posts + prior)
        }))
        .sort((a, b) => b.score - a.score);
}

export function createChannelStats(store) {
    async function load() {
        return (await store.get(STATS_KEY)) ?? {};
    }

    function prune(stats) {
        const keys = Object.keys(stats);
        if (keys.length <= MAX_TRACKED_TAGS) return stats;
        keys.sort((a, b) => stats[a][0] - stats[b][0]);
        for (const key of keys.slice(0, keys.length - MAX_TRACKED_TAGS)) delete stats[key];
        return stats;
    }

    return {
        /** Запомнить, что в канал ушёл пост. */
        async recordPost(messageId, post) {
            const tags = statTags(post);
            await store.set(`ch:msg:${messageId}`, { postId: post.id, tags, reactions: 0 }, { ttlSeconds: MSG_TTL });
            const stats = await load();
            for (const tag of tags) {
                const [posts = 0, reactions = 0] = stats[tag] ?? [];
                stats[tag] = [posts + 1, reactions];
            }
            await store.set(STATS_KEY, prune(stats));
        },

        /** Пришло новое количество реакций на сообщение. */
        async updateReactions(messageId, total) {
            const record = await store.get(`ch:msg:${messageId}`);
            if (!record) return false;
            const delta = total - record.reactions;
            if (!delta) return true;

            record.reactions = total;
            await store.set(`ch:msg:${messageId}`, record, { ttlSeconds: MSG_TTL });

            const stats = await load();
            for (const tag of record.tags) {
                const [posts = 1, reactions = 0] = stats[tag] ?? [];
                stats[tag] = [posts, Math.max(0, reactions + delta)];
            }
            await store.set(STATS_KEY, stats);
            return true;
        },

        async top(limit = 10) {
            return rankTags(await load()).slice(0, limit);
        },

        /** Случайный тег из самых «залайканных» (чем выше — тем вероятнее). */
        async pickLikedTag({ top = 15 } = {}) {
            const ranked = rankTags(await load()).filter(t => t.reactions > 0).slice(0, top);
            if (!ranked.length) return null;
            const weights = ranked.map((t, i) => t.score * (top - i));
            let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
            for (let i = 0; i < ranked.length; i++) {
                roll -= weights[i];
                if (roll <= 0) return ranked[i].tag;
            }
            return ranked[0].tag;
        }
    };
}
