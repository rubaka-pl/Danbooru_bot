// Запуск в режиме постоянного сервера (Render, VPS, локально): long polling + автопост по таймеру.
import { ALLOWED_UPDATES, createApp } from './app.js';
import { adultAutopostDeps, startAutopostLoop } from './services/autopost.js';
import { startDigestLoop } from './services/subscriptions.js';
import { COMMANDS } from './bot/handlers/start.js';
import { createHttpServer } from './server.js';
import { launchPolling } from './bot/launch.js';
import { startKeepAlive } from './services/keepAlive.js';
import { cleanBotProfile } from './services/botProfile.js';

const app = createApp();
const { bot, config, history, store } = app;

await history.load();
await store.load();

// Render требует открытый порт: / — для keep-alive, /health — для автоперезапуска
const server = createHttpServer(app);
server.listen(config.port, () => console.log(`🌐 Health-check на порту ${config.port} (/health)`));

// Непойманные ошибки: логируем и сообщаем админу. После uncaughtException процесс
// в неизвестном состоянии — выходим, хостинг перезапустит бота.
process.on('unhandledRejection', (error) => {
    console.error('❌ unhandledRejection:', error);
    app.alerts.notify('unhandled', `Необработанная ошибка: ${error?.message ?? error}`).catch(() => {});
});
process.on('uncaughtException', async (error) => {
    console.error('❌ uncaughtException:', error);
    await app.alerts.notify('uncaught', `Бот упал и перезапускается: ${error?.message ?? error}`).catch(() => {});
    process.exit(1);
});

let stopAutopost = () => {};
if (config.autopost.enabled && config.autopost.channelId) {
    stopAutopost = startAutopostLoop({ ...app, telegram: bot.telegram });
}
let stopAdultAutopost = () => {};
if (config.autopost.enabled && config.adult.enabled && config.adult.channelId) {
    stopAdultAutopost = startAutopostLoop(adultAutopostDeps({ ...app, telegram: bot.telegram }));
    console.log(`🔞 Автопост 18+ в ${config.adult.channelId}`);
}

const stopDigest = startDigestLoop({ ...app, telegram: bot.telegram });
const stopKeepAlive = startKeepAlive({ url: config.keepAliveUrl });

const storage = config.redis.url ? 'Upstash Redis' : `файл ${config.storeFile}`;
console.log(`🗄 Хранилище: ${storage}`);
if (!config.redis.url) {
    console.warn('⚠️ Redis не подключён: на бесплатном Render избранное и подписки сотрутся при перезапуске (см. docs/SETUP.md)');
}


launchPolling(bot, {
    allowedUpdates: ALLOWED_UPDATES,
    alerts: app.alerts,
    onLaunch: () => {
        console.log(`🟢 Бот @${bot.botInfo?.username} запущен и ждёт сообщений`);
        bot.telegram.setMyCommands(COMMANDS).catch(error => console.warn('⚠️ setMyCommands:', error.message));
        if (config.cleanProfile) {
            cleanBotProfile(bot.telegram).catch(error => console.warn('⚠️ Проверка профиля бота:', error.message));
        }
    }
}).catch(error => {
    console.error('❌ Не удалось запустить бота:', error);
    process.exit(1);
});

const shutdown = async (signal) => {
    console.log(`🛑 ${signal}: останавливаюсь…`);
    stopAutopost();
    stopAdultAutopost();
    stopDigest();
    stopKeepAlive();
    bot.stop(signal);
    server.close();
    if (history.save) await history.save();
    if (store.save) await store.save();
    process.exit(0);
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
