import http from 'node:http';

/**
 * HTTP-сервер для хостинга:
 *   /        — «Bot is running.» (для keep-alive пингов)
 *   /health  — JSON-состояние; 503, если бот «завис» (Render перезапустит сервис сам)
 */
export function createHttpServer({ health, config }) {
    return http.createServer((req, res) => {
        if (req.url?.startsWith('/health')) {
            const snapshot = health.snapshot({ autopostEnabled: config.autopost.enabled && Boolean(config.autopost.channelId) });
            res.writeHead(snapshot.ok ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(snapshot));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bot is running.');
    });
}
