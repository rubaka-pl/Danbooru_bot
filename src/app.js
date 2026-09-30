import { config } from './config.js';
import { createDanbooruClient } from './services/danbooru.js';
import { createTagResolver } from './services/tagResolver.js';
import { FileHistory, MemoryHistory, RedisHistory } from './services/history.js';
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

    let history;
    if (config.redis.url && config.redis.token) {
        history = new RedisHistory(config.redis);
    } else if (serverless) {
        console.warn('⚠️ Redis не настроен — история автопоста не сохраняется между запусками');
        history = new MemoryHistory(config.autopost.historyLimit);
    } else {
        history = new FileHistory(config.autopost.historyFile, config.autopost.historyLimit);
    }

    const deps = { config, client, resolver, history, runTask };
    const bot = createBot(deps);

    return { ...deps, bot };
}
