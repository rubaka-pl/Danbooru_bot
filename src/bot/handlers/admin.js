import { Markup } from 'telegraf';
import { adultAutopostDeps, autopostOnce, PAUSED_KEY } from '../../services/autopost.js';
import { runRecapIfDue } from '../../services/recap.js';
import { isQuietTime } from '../../utils/quietHours.js';
import { escapeHtml, humanizeTag } from '../../utils/format.js';

/**
 * Админ-панель владельца канала: /admin, /post, /post18, /pause, /resume, /recap.
 * Работает только для ADMIN_IDS (если список пуст — выключена).
 */
export function registerAdmin(bot, deps) {
    const { config, store, userData, channelStats } = deps;
    const isAdmin = (ctx) => config.adminIds.includes(ctx.from?.id);

    const guard = (handler) => async (ctx) => {
        if (!isAdmin(ctx)) {
            if (ctx.callbackQuery) return ctx.answerCbQuery('🔒 Только для админов');
            return ctx.reply(config.adminIds.length
                ? '🔒 Эта команда только для админов.'
                : '🔒 Админ-команды выключены: задай ADMIN_IDS в переменных окружения.');
        }
        return handler(ctx);
    };

    async function status() {
        const paused = Boolean(await store.get(PAUSED_KEY));
        const { quietHours, timeZone, channelId } = config.autopost;
        const quiet = quietHours && isQuietTime(new Date(), { ...quietHours, timeZone });
        const subsChats = (await userData.subscriptions.chats()).length;
        const top = await channelStats.top(3);
        const text = [
            '🛠 <b>Админка</b>',
            '',
            `📡 Канал: ${escapeHtml(String(channelId))}`,
            config.adult.enabled && config.adult.channelId && `🔞 18+: ${escapeHtml(String(config.adult.channelId))}`,
            `Автопост: ${!config.autopost.enabled ? '⛔ выключен (AUTOPOST=off)' : paused ? '⏸ на паузе' : quiet ? '🌙 тихие часы' : '▶️ работает'}`,
            `🔔 Чатов с подписками: ${subsChats}`,
            top.length && `📊 Лучше всего заходят: ${top.map(t => escapeHtml(humanizeTag(t.tag))).join(', ')}`
        ].filter(Boolean).join('\n');
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback(paused ? '▶️ Продолжить автопост' : '⏸ Пауза автопоста', 'adm:toggle')],
            [Markup.button.callback('📤 Запостить сейчас', 'adm:post'), Markup.button.callback('🏆 Топ недели сейчас', 'adm:recap')]
        ]);
        return { text, extra: { parse_mode: 'HTML', ...keyboard } };
    }

    const postNow = async (ctx) => {
        const result = await autopostOnce({ ...deps, telegram: ctx.telegram, force: true });
        return result === 'empty' ? '😔 Не нашлось новой картинки' : `📤 Готово (${result === 'album' ? 'альбом' : 'пост'})`;
    };

    const postAdultNow = async (ctx) => {
        if (!config.adult.enabled || !config.adult.channelId) return '🔞 Автопост 18+ выключен (ADULT_GROUP_ID / ADULT_AUTOPOST)';
        const result = await autopostOnce({ ...adultAutopostDeps({ ...deps, telegram: ctx.telegram }), force: true });
        return result === 'empty' ? '😔 Не нашлось новой картинки 18+' : `🔞 Готово (${result === 'album' ? 'альбом' : 'пост'})`;
    };

    const recapNow = async (ctx) => {
        const result = await runRecapIfDue({ ...deps, telegram: ctx.telegram }, { force: true });
        return result === 'posted' ? '🏆 Топ недели опубликован' : '😔 За неделю нет постов с реакциями';
    };

    bot.command('admin', guard(async (ctx) => {
        const { text, extra } = await status();
        await ctx.reply(text, extra);
    }));

    bot.command('post', guard(async (ctx) => ctx.reply(await postNow(ctx))));
    bot.command('post18', guard(async (ctx) => ctx.reply(await postAdultNow(ctx))));
    bot.command('recap', guard(async (ctx) => ctx.reply(await recapNow(ctx))));
    bot.command('pause', guard(async (ctx) => {
        await store.set(PAUSED_KEY, true);
        await ctx.reply('⏸ Автопост на паузе (и 18+ тоже). Вернуть: /resume');
    }));
    bot.command('resume', guard(async (ctx) => {
        await store.del(PAUSED_KEY);
        await ctx.reply('▶️ Автопост снова работает');
    }));

    bot.action('adm:toggle', guard(async (ctx) => {
        if (await store.get(PAUSED_KEY)) await store.del(PAUSED_KEY);
        else await store.set(PAUSED_KEY, true);
        await ctx.answerCbQuery('✅');
        const { text, extra } = await status();
        await ctx.editMessageText(text, extra).catch(() => {});
    }));
    bot.action('adm:post', guard(async (ctx) => {
        await ctx.answerCbQuery('📤 Публикую…');
        await ctx.reply(await postNow(ctx));
    }));
    bot.action('adm:recap', guard(async (ctx) => {
        await ctx.answerCbQuery('🏆 Публикую…');
        await ctx.reply(await recapNow(ctx));
    }));
}
