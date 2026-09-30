/**
 * Минимальный клиент Upstash Redis REST API (без зависимостей).
 */
export function createRedis({ url, token }) {
    const base = url.replace(/\/$/, '');
    return async function command(...args) {
        const res = await fetch(base, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(args.map(String)),
            signal: AbortSignal.timeout(5000)
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.error) throw new Error(body.error || `Redis HTTP ${res.status}`);
        return body.result;
    };
}
