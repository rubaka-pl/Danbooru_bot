import { isMetatag } from '../utils/query.js';
import { hasCyrillic, transliterate } from '../utils/translit.js';

const toTag = (t) => ({ name: t.name, postCount: t.post_count ?? 0, category: t.category ?? 0 });

/**
 * Превращает то, что написал пользователь ("naruto uzumaki", "мику", "rem"),
 * в существующие теги Danbooru.
 */
export function createTagResolver(client, { cacheSize = 1000 } = {}) {
    const cache = new Map();

    const safe = async (fn) => {
        try {
            return await fn();
        } catch (error) {
            if (error?.isRateLimit) throw error;
            return null;
        }
    };

    // Точное совпадение с тегом или его алиасом.
    async function exact(name) {
        const tag = await safe(() => client.tagByName(name));
        if (tag && tag.post_count > 0) return toTag(tag);

        const aliased = await safe(() => client.aliasOf(name));
        if (aliased && aliased !== name) {
            const target = await safe(() => client.tagByName(aliased));
            if (target && target.post_count > 0) return toTag(target);
        }
        return null;
    }

    // Нечёткий поиск: автодополнение Danbooru, затем поиск по подстроке.
    async function fuzzy(name) {
        const suggestions = await safe(() => client.autocomplete(name)) ?? [];
        const best = suggestions.find(s => s.value && !isMetatag(s.value) && (s.post_count ?? 1) > 0);
        if (best) {
            const tag = await safe(() => client.tagByName(best.value));
            if (tag && tag.post_count > 0) return toTag(tag);
            return { name: best.value, postCount: best.post_count ?? 0, category: best.category ?? 0 };
        }

        if (name.length >= 3) {
            const matches = await safe(() => client.tagsMatching(`*${name}*`)) ?? [];
            if (matches[0]) return toTag(matches[0]);
        }
        return null;
    }

    async function resolveUncached(name) {
        // На Danbooru нет русских названий — пробуем транслит: "наруто" → "naruto"
        if (hasCyrillic(name)) return resolve(transliterate(name));

        const words = name.split('_').filter(Boolean);

        const direct = await exact(name);
        if (direct) return [direct];

        // "naruto uzumaki" → "uzumaki_naruto" (японский порядок имени)
        if (words.length === 2) {
            const reversed = await exact(`${words[1]}_${words[0]}`);
            if (reversed) return [reversed];
        }

        // "miku swimsuit" → два отдельных тега, если оба существуют
        if (words.length > 1) {
            const parts = await Promise.all(words.map(exact));
            if (parts.every(Boolean)) return parts;
        }

        const guess = await fuzzy(name);
        if (guess) return [guess];

        if (words.length > 1) {
            const parts = [];
            for (const word of words) {
                const part = (await exact(word)) ?? (await fuzzy(word));
                if (!part) {
                    parts.length = 0;
                    break;
                }
                parts.push(part);
            }
            if (parts.length) return parts;
        }

        return [];
    }

    /**
     * @returns {Promise<Array<{name: string, postCount: number, category: number}>>}
     *   пустой массив, если ничего не найдено
     */
    async function resolve(name) {
        if (cache.has(name)) return cache.get(name);
        const result = await resolveUncached(name);
        if (cache.size >= cacheSize) cache.delete(cache.keys().next().value);
        cache.set(name, result);
        return result;
    }

    /**
     * Разрешает одну строку запроса (группу терминов).
     */
    async function resolveGroup(group) {
        const tags = [];
        const unresolved = [];

        for (const term of group.terms) {
            if (term.kind === 'meta') {
                tags.push({ name: term.tag, negated: term.negated, meta: true, postCount: 0 });
                continue;
            }
            const found = await resolve(term.tag);
            if (!found.length) {
                unresolved.push(term.raw);
                continue;
            }
            for (const tag of found) {
                if (!tags.some(t => t.name === tag.name)) tags.push({ ...tag, negated: term.negated });
            }
        }

        return { label: group.label, tags, unresolved };
    }

    /**
     * Подсказки для ненайденного тега (опечатки): до 3 похожих по написанию тегов.
     */
    async function suggest(raw) {
        const name = hasCyrillic(raw) ? transliterate(raw) : raw;
        const fuzzy = await safe(() => client.tagsFuzzy(name, 5)) ?? [];
        return fuzzy
            .filter(t => t?.name && t.post_count > 0)
            .map(toTag)
            .slice(0, 3);
    }

    return { resolve, resolveGroup, suggest };
}
