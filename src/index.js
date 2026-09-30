// Запуск в режиме постоянного сервера (Render, VPS, локально): long polling + автопост по таймеру.
import http from 'node:http';
import { ALLOWED_UPDATES, createApp } from './app.js';
import { startAutopostLoop } from './services/autopost.js';
import { startDigestLoop } from './services/subscriptions.js';
import { COMMANDS } from './bot/handlers/start.js';

const app = createApp();
const { bot, config, history, store } = app;

await history.load();
await store.load();

// Render требует открытый порт — простой health-check
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bot is running.');
});
server.listen(config.port, () => console.log(`🌐 Health-check на порту ${config.port}`));

let stopAutopost = () => {};
if (config.autopost.enabled && config.autopost.channelId) {
    stopAutopost = startAutopostLoop({ ...app, telegram: bot.telegram });
}

const stopDigest = startDigestLoop({ ...app, telegram: bot.telegram });

bot.launch({ dropPendingUpdates: true, allowedUpdates: ALLOWED_UPDATES }, () => {
    console.log(`🟢 Бот @${bot.botInfo?.username} запущен`);
    bot.telegram.setMyCommands(COMMANDS).catch(error => console.warn('⚠️ setMyCommands:', error.message));
}).catch(error => {
    console.error('❌ Не удалось запустить бота:', error);
    process.exit(1);
});

const shutdown = async (signal) => {
    console.log(`🛑 ${signal}: останавливаюсь…`);
    stopAutopost();
    stopDigest();
    bot.stop(signal);
    server.close();
    if (history.save) await history.save();
    if (store.save) await store.save();
    process.exit(0);
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
