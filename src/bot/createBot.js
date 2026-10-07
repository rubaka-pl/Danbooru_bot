import { Telegraf } from 'telegraf';
import { logUpdates } from './launch.js';
import { registerStartHandlers } from './handlers/start.js';
import { registerTagFeed } from './handlers/tagFeed.js';
import { registerChannel } from './handlers/channel.js';
import { registerPostActions } from './handlers/postActions.js';
import { registerFavorites } from './handlers/favorites.js';
import { registerBlocklist } from './handlers/blocklist.js';
import { registerSubscriptions } from './handlers/subscriptions.js';
import { registerInline } from './handlers/inline.js';
import { registerReverseSearch } from './handlers/reverse.js';
import { registerSettings } from './handlers/settings.js';
import { registerForYou } from './handlers/forYou.js';
import { registerQuiz } from './handlers/quiz.js';
import { registerInfo } from './handlers/info.js';
import { registerAdmin } from './handlers/admin.js';
import { registerProfile } from './handlers/profile.js';
import { registerSearchHandlers, registerTextSearch } from './handlers/search.js';

export function createBot(deps) {
    const bot = new Telegraf(deps.config.botToken, { handlerTimeout: 60_000 });

    bot.use((ctx, next) => {
        deps.health?.markUpdate();
        deps.runner?.rememberBot?.(ctx.botInfo);
        return next();
    });
    // Первым делом — строка в лог: видно, доходят ли сообщения до бота
    if (deps.config.logUpdates) bot.use(logUpdates());

    // Раньше /start: ссылки-теги приходят как «/start t…»
    registerTagFeed(bot, deps);
    registerStartHandlers(bot);
    registerChannel(bot, deps);
    registerPostActions(bot, deps);
    registerFavorites(bot, deps);
    registerBlocklist(bot, deps);
    registerSubscriptions(bot, deps);
    registerInline(bot, deps);
    registerReverseSearch(bot, deps);
    registerSettings(bot, deps);
    registerForYou(bot, deps);
    registerQuiz(bot, deps);
    registerInfo(bot, deps);
    registerAdmin(bot, deps);
    registerProfile(bot, deps);
    registerSearchHandlers(bot, deps);
    // Обычный текст — последним, чтобы не перехватывать команды
    registerTextSearch(bot, deps);

    bot.catch((error, ctx) => {
        console.error(`❌ Ошибка в обработчике (${ctx.updateType}):`, error);
        deps.alerts?.notify('handler', `Ошибка в обработчике (${ctx.updateType}): ${error?.message ?? error}`).catch(() => {});
    });

    return bot;
}
