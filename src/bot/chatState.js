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
