import { escapeHtml, humanizeTag } from '../../utils/format.js';
import { totalReactions } from '../../services/channelStats.js';

/**
 * Реакции в канале → статистика; /stats — что заходит подписчикам.
 * Боту нужны права администратора в канале, а в allowed_updates — message_reaction_count.
 */
export function registerChannel(bot, { channelStats, config }) {
    bot.on('message_reaction_count', async (ctx) => {
        const update = ctx.update.message_reaction_count;
        try {
            await channelStats.updateReactions(update.message_id, totalReactions(update.reactions));
        } catch (error) {
            console.error('❌ Реакции:', error.message);
        }
    });

    bot.command('stats', async (ctx) => {
        if (config.adminIds.length && !config.adminIds.includes(ctx.from.id)) {
            return ctx.reply('🔒 Статистика доступна только администраторам канала.');
        }
        const top = await channelStats.top(15);
        if (!top.length) {
            return ctx.reply('📊 Статистики пока нет — нужно, чтобы под постами в канале появились реакции.');
        }
        await ctx.reply([
            '📊 <b>Что больше всего заходит в канале</b>',
            '<i>(реакций в среднем на пост · постов)</i>',
            '',
            ...top.map((t, i) => `${i + 1}. ${escapeHtml(humanizeTag(t.tag))} — ${(t.reactions / t.posts).toFixed(1)} · ${t.posts}`),
            '',
            `Автопост подбирает ~${Math.round(config.autopost.adaptiveShare * 100)}% картинок по этим тегам.`
        ].join('\n'), { parse_mode: 'HTML' });
    });
}
