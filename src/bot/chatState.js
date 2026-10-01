// Состояние чатов в памяти процесса. В serverless-режиме живёт только
// пока инстанс "тёплый", поэтому здесь нет ничего критичного.

const MAX_CHATS = 5000;
const MAX_SEEN = 2000;

const busy = new Set();
const seen = new Map();

export function tryLock(chatId) {
    if (busy.has(chatId)) return false;
    busy.add(chatId);
    return true;
}

export function unlock(chatId) {
    busy.delete(chatId);
}

/** Картинки, которые этот пользователь уже видел — чтобы не повторяться. */
export function seenFor(chatId) {
    let set = seen.get(chatId);
    if (!set) {
        if (seen.size >= MAX_CHATS) seen.delete(seen.keys().next().value);
        set = new Set();
        seen.set(chatId, set);
    }
    return {
        has: (md5) => set.has(md5),
        add: (md5) => {
            set.add(md5);
            if (set.size > MAX_SEEN) set.delete(set.values().next().value);
        }
    };
}

// ---------- Лимит картинок в час (защита от спама и лимитов Danbooru) ----------
const HOUR = 60 * 60 * 1000;
const sentTimes = new Map();

function recentTimes(chatId, now) {
    const times = (sentTimes.get(chatId) ?? []).filter(t => now - t < HOUR);
    sentTimes.set(chatId, times);
    return times;
}

export function recordSent(chatId, now = Date.now()) {
    if (!sentTimes.has(chatId) && sentTimes.size >= MAX_CHATS) sentTimes.delete(sentTimes.keys().next().value);
    recentTimes(chatId, now).push(now);
}

/**
 * @returns {{ limited: boolean, retryInMinutes: number }}
 */
export function hourlyQuota(chatId, limit, now = Date.now()) {
    if (!limit) return { limited: false, retryInMinutes: 0 };
    const times = recentTimes(chatId, now);
    if (times.length < limit) return { limited: false, retryInMinutes: 0 };
    const oldest = times[times.length - limit];
    return { limited: true, retryInMinutes: Math.max(1, Math.ceil((oldest + HOUR - now) / 60000)) };
}

/** Сброс состояния (для тестов). */
export function resetChatState() {
    busy.clear();
    seen.clear();
    sentTimes.clear();
}
