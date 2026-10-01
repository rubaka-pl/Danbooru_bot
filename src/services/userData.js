/*
 * Данные пользователей поверх key-value хранилища:
 * избранное, блок-лист тегов и подписки.
 */

const MAX_FAVS = 500;
const MAX_BLOCKED = 100;
const MAX_SUBS = 10;

const favKey = (chatId) => `u:${chatId}:favs`;
const blockKey = (chatId) => `u:${chatId}:block`;
const subsKey = (chatId) => `u:${chatId}:subs`;
const settingsKey = (chatId) => `u:${chatId}:settings`;
const SUB_CHATS_KEY = 'subs:chats';
const QUIZ_KEY = 'quiz:scores';
const historyKey = (chatId) => `u:${chatId}:history`;
const MAX_HISTORY = 10;

/** Быстрые фильтры в /settings: что скрывать (ключ → теги Danbooru). */
export const HIDE_PRESETS = {
    yaoi: { label: '👨‍❤️‍👨 яой / парни', tags: ['yaoi', 'male_focus'] },
    yuri: { label: '👩‍❤️‍👩 юри', tags: ['yuri'] },
    futa: { label: 'футанари', tags: ['futanari'] },
    furry: { label: '🐾 фурри', tags: ['furry'] },
    guro: { label: '🩸 гуро', tags: ['guro'] }
};

export const DEFAULT_SETTINGS = {
    rating: 'general', // рейтинг по умолчанию
    count: 3,          // сколько картинок в быстром режиме
    quick: false,      // быстрый режим: искать сразу, без подтверждения
    safe: false,       // безопасный режим: никогда не показывать 18+
    hide: []           // ключи HIDE_PRESETS
};

export function createUserData(store) {
    const list = async (key) => (await store.get(key)) ?? [];

    // ---------- Избранное ----------
    const favorites = {
        list: (chatId) => list(favKey(chatId)),

        /** @returns {Promise<boolean>} true — добавлено, false — удалено */
        async toggle(chatId, postId) {
            const favs = await list(favKey(chatId));
            const index = favs.indexOf(postId);
            if (index >= 0) favs.splice(index, 1);
            else favs.unshift(postId);
            await store.set(favKey(chatId), favs.slice(0, MAX_FAVS));
            return index < 0;
        },

        async remove(chatId, postId) {
            const favs = await list(favKey(chatId));
            await store.set(favKey(chatId), favs.filter(id => id !== postId));
        }
    };

    // ---------- Блок-лист ----------
    const blocklist = {
        list: (chatId) => list(blockKey(chatId)),

        async add(chatId, tags) {
            const current = await list(blockKey(chatId));
            const added = tags.filter(tag => !current.includes(tag));
            await store.set(blockKey(chatId), [...current, ...added].slice(0, MAX_BLOCKED));
            return added;
        },

        async remove(chatId, tags) {
            const current = await list(blockKey(chatId));
            const next = current.filter(tag => !tags.includes(tag));
            await store.set(blockKey(chatId), next);
            return current.length - next.length;
        },

        /**
         * Функция-фильтр: true, если в посте есть заблокированный тег
         * (свой блок-лист + быстрые фильтры из /settings).
         * Свойство `active` — включён ли хоть один фильтр.
         */
        async matcher(chatId) {
            const own = await list(blockKey(chatId));
            const settings = (await store.get(settingsKey(chatId))) ?? {};
            const presetTags = (settings.hide ?? []).flatMap(key => HIDE_PRESETS[key]?.tags ?? []);
            const blocked = [...new Set([...own, ...presetTags])];
            if (!blocked.length) return Object.assign(() => false, { active: false });
            return Object.assign((post) => {
                const tags = new Set((post.tag_string || '').split(' '));
                return blocked.some(tag => tags.has(tag));
            }, { active: true });
        }
    };

    // ---------- Подписки ----------
    const subscriptions = {
        list: (chatId) => list(subsKey(chatId)),

        async add(chatId, sub) {
            const subs = await list(subsKey(chatId));
            if (subs.length >= MAX_SUBS) return { ok: false, reason: 'limit' };
            const key = sub.tags.join(' ');
            if (subs.some(s => s.tags.join(' ') === key)) return { ok: false, reason: 'exists' };
            subs.push(sub);
            await store.set(subsKey(chatId), subs);

            const chats = await list(SUB_CHATS_KEY);
            if (!chats.includes(chatId)) await store.set(SUB_CHATS_KEY, [...chats, chatId]);
            return { ok: true };
        },

        async removeAt(chatId, index) {
            const subs = await list(subsKey(chatId));
            const [removed] = subs.splice(index, 1);
            await store.set(subsKey(chatId), subs);
            if (!subs.length) await subscriptions.forgetChat(chatId, { keepSubs: true });
            return removed ?? null;
        },

        async save(chatId, subs) {
            await store.set(subsKey(chatId), subs);
        },

        chats: () => list(SUB_CHATS_KEY),

        async forgetChat(chatId, { keepSubs = false } = {}) {
            const chats = await list(SUB_CHATS_KEY);
            await store.set(SUB_CHATS_KEY, chats.filter(id => id !== chatId));
            if (!keepSubs) await store.del(subsKey(chatId));
        }
    };

    // ---------- Настройки ----------
    const settings = {
        async get(chatId) {
            return { ...DEFAULT_SETTINGS, ...((await store.get(settingsKey(chatId))) ?? {}) };
        },

        async update(chatId, patch) {
            const next = { ...(await settings.get(chatId)), ...patch };
            await store.set(settingsKey(chatId), next);
            return next;
        }
    };

    // ---------- Викторина ----------
    const quiz = {
        async record(user, correct) {
            const scores = (await store.get(QUIZ_KEY)) ?? {};
            const entry = scores[user.id] ?? { name: '', correct: 0, total: 0, streak: 0, best: 0 };
            entry.name = user.first_name || user.username || String(user.id);
            entry.total++;
            if (correct) {
                entry.correct++;
                entry.streak++;
                entry.best = Math.max(entry.best, entry.streak);
            } else {
                entry.streak = 0;
            }
            scores[user.id] = entry;
            await store.set(QUIZ_KEY, scores);
            return entry;
        },

        async get(userId) {
            const scores = (await store.get(QUIZ_KEY)) ?? {};
            return scores[userId] ?? null;
        },

        async leaderboard(limit = 10) {
            const scores = (await store.get(QUIZ_KEY)) ?? {};
            return Object.entries(scores)
                .map(([id, s]) => ({ id: Number(id), ...s }))
                .sort((a, b) => b.correct - a.correct || a.total - b.total)
                .slice(0, limit);
        }
    };

    // ---------- История запросов ----------
    const history = {
        list: (chatId) => list(historyKey(chatId)),

        /** @param {string[]} tags — теги запроса ("-tag" для исключений) */
        async add(chatId, tags) {
            if (!tags.length) return;
            const key = tags.join(' ');
            const items = (await list(historyKey(chatId))).filter(item => item.join(' ') !== key);
            items.unshift(tags);
            await store.set(historyKey(chatId), items.slice(0, MAX_HISTORY));
        },

        clear: (chatId) => store.del(historyKey(chatId))
    };

    return { favorites, blocklist, subscriptions, settings, quiz, history };
}
