/*
 * Бесплатный Render усыпляет сервис через 15 минут без входящих HTTP-запросов —
 * и вместе с ним засыпают автопост и ответы в личке (сообщения из Telegram его не будят).
 * Бот сам заходит на свой публичный адрес каждые 10 минут, чтобы не уснуть.
 * Render сам передаёт адрес в RENDER_EXTERNAL_URL.
 */
export function startKeepAlive({ url, intervalMs = 10 * 60 * 1000, fetchImpl, log = console } = {}) {
    if (!url) return () => {};
    const target = new URL('/health', url).toString();
    const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));

    const ping = async () => {
        try {
            await doFetch(target, { signal: AbortSignal.timeout(30_000) });
        } catch (error) {
            log.warn(`⚠️ Keep-alive: ${target} не ответил: ${error.message}`);
        }
    };

    log.log(`🔁 Не даю хостингу уснуть: захожу на ${target} каждые ${Math.round(intervalMs / 60000)} мин`);
    const timer = setInterval(ping, intervalMs);
    return () => clearInterval(timer);
}
