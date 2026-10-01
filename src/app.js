import { config } from './config.js';
import { createDanbooruClient } from './services/danbooru.js';
import { createTagResolver } from './services/tagResolver.js';
import { FileHistory, MemoryHistory, RedisHistory } from './services/history.js';
import { CachedStore, FileStore, MemoryStore, RedisStore } from './services/store.js';
import { createAlerts } from './services/alerts.js';
import { createHealth } from './services/health.js';
import { createUserData } from './services/userData.js';
import { createChannelStats } from './services/channelStats.js';
import { createSearchRunner } from './bot/searchRunner.js';
import { createBot } from './bot/createBot.js';

/**
 * Собирает все зависимости бота.
 * @param {object} options
 * @param {boolean} options.serverless — без диска (Vercel)
 * @param {(promise: Promise) => void} options.runTask
 */
export function createApp({ serverless = false, runTask = (p) => p.catch(console.error) } = {}) {
    if (!config.botToken) {
        throw new Error('Не задан BOT_TOKEN');
    }

    const client = createDanbooruClient(config.danbooru);
    const resolver = createTagResolver(client);
    const hasRedis = Boolean(config.redis.url && config.redis.token);

    let history;
    let store;
    if (hasRedis) {
        history = new RedisHistory(config.redis);
        store = serverless ? new RedisStore(config.redis) : new CachedStore(new RedisStore(config.redis));
    } else if (serverless) {
        console.warn('⚠️ Redis не настроен — избранное, подписки и история не сохраняются между запусками');
        history = new MemoryHistory(config.autopost.historyLimit);
        store = new MemoryStore();
    } else {
        history = new FileHistory(config.autopost.historyFile, config.autopost.historyLimit);
        store = new FileStore(config.storeFile);
    }

    const userData = createUserData(store);
    const channelStats = createChannelStats(store);
    const runner = createSearchRunner({ client, config, userData, runTask });

    let bot;
    const alerts = createAlerts({ getTelegram: () => bot.telegram, config });
    const health = createHealth();

    const deps = { config, client, resolver, history, store, userData, channelStats, runner, runTask, alerts, health };
    bot = createBot(deps);

    return { ...deps, bot };
}

/** Какие апдейты нужны боту (message_reaction_count сам по себе не приходит). */
export const ALLOWED_UPDATES = ['message', 'callback_query', 'inline_query', 'message_reaction_count', 'poll'];
