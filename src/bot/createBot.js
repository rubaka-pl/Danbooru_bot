import { Telegraf } from 'telegraf';
import { registerStartHandlers } from './handlers/start.js';
import { registerSearchHandlers } from './handlers/search.js';

/**
 * @param {object} deps
 * @param {(promise: Promise) => void} deps.runTask — как запускать долгие фоновые задачи
 */
export function createBot(deps) {
    const bot = new Telegraf(deps.config.botToken, { handlerTimeout: 60_000 });

    registerStartHandlers(bot);
    registerSearchHandlers(bot, deps);

    bot.catch((error, ctx) => {
        console.error(`❌ Ошибка в обработчике (${ctx.updateType}):`, error);
    });

    return bot;
}
