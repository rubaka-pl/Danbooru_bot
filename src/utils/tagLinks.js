/*
 * Теги в подписи — ссылки вида https://t.me/<бот>?start=<payload>.
 * Клик открывает бота и сразу переключает ленту на этот тег,
 * вместо глобального поиска хэштега по всему Telegram.
 *
 * payload: "t<r>_<base64url(тег)>", r — рейтинг ленты (g/s/e/a).
 * Telegram разрешает в payload до 64 символов [A-Za-z0-9_-].
 */

const RATING_CHARS = { general: 'g', sensitive: 's', explicit: 'e', any: 'a' };
const MAX_PAYLOAD = 64;

export function encodeTagPayload(tag, rating) {
    const payload = `t${RATING_CHARS[rating] ?? ''}_${Buffer.from(String(tag)).toString('base64url')}`;
    return payload.length <= MAX_PAYLOAD ? payload : null;
}

/** @returns {{ tag: string, rating: string|null } | null} */
export function decodeTagPayload(payload) {
    const match = /^t([gsea]?)_([A-Za-z0-9_-]+)$/.exec(payload || '');
    if (!match) return null;
    const tag = Buffer.from(match[2], 'base64url').toString('utf8');
    if (!tag || /\s/.test(tag)) return null;
    const rating = Object.keys(RATING_CHARS).find(key => RATING_CHARS[key] === match[1]) ?? null;
    return { tag, rating };
}

/** Функция «тег → ссылка» для buildCaption; null — ссылок не будет (останутся хэштеги). */
export function tagLinker(botUsername, rating) {
    if (!botUsername) return null;
    return (tag) => {
        const payload = encodeTagPayload(tag, rating);
        return payload ? `https://t.me/${botUsername}?start=${payload}` : null;
    };
}
