import { Markup } from 'telegraf';
import { parseUserInput } from '../../utils/query.js';
import { DEFAULT_RATING, isNsfwTag, ratingLabel } from '../../utils/ratings.js';
import { escapeHtml } from '../../utils/format.js';
import { deliverForChat, latestPostId, subTagsToQuery } from '../../services/subscriptions.js';
import { parseGroupsFromMessage } from '../request.js';
import { BUSY_TEXT } from '../searchRunner.js';

const tagToString = (t) => `${t.negated ? '-' : ''}${t.name}`;

/**
 * /sub, /subs — подписки «присылай новые арты с тегом X раз в день».
 */
export function registerSubscriptions(bot, deps) {
    const { resolver, userData, client, config, runner } = deps;
    const { hour } = config.subscriptions;

    async function subscribe(chatId, tags, rating) {
        const names = tags.map(tagToString);
        const lastId = await latestPostId(client, subTagsToQuery(names), rating, config.danbooru.tagLimit).catch(() => 0);
        const result = await userData.subscriptions.add(chatId, { tags: names, rating, lastId, createdAt: Date.now() });
        const title = `<code>${escapeHtml(names.join(' + '))}</code>`;
        if (result.ok) return `🔔 Подписка на ${title} (${ratingLabel(rating)}) оформлена!\nКаждый день после ${hour}:00 пришлю новые арты. Список — /subs`;
        if (result.reason === 'exists') return `ℹ️ Ты уже подписан на ${title}`;
        return '⚠️ Максимум 10 подписок. Удали лишние в /subs';
    }

    bot.command('sub', async (ctx) => {
        const parsed = parseUserInput((ctx.payload || '').replace(/\n/g, ', '), { maxGroups: 1 });
        if (!parsed.groups.length) {
            return ctx.reply('Напиши, на что подписаться: <code>/sub hatsune miku</code> или <code>/sub rem, maid</code>', { parse_mode: 'HTML' });
        }
        const group = await resolver.resolveGroup(parsed.groups[0]);
        if (!group.tags.some(t => !t.negated)) {
            return ctx.reply(`❌ Не нашёл такие теги: ${group.unresolved.join(', ')}`);
        }
        const rating = parsed.rating
            ?? (group.tags.some(t => !t.negated && isNsfwTag(t.name)) ? 'explicit' : DEFAULT_RATING);
        await ctx.reply(await subscribe(ctx.chat.id, group.tags, rating), { parse_mode: 'HTML' });
    });

    // Кнопка «🔔 Подписаться» под результатами поиска
    bot.action(/^sub:(\w+)$/, async (ctx) => {
        const groups = parseGroupsFromMessage(ctx.callbackQuery.message?.text);
        if (!groups.length) return ctx.answerCbQuery('Запрос устарел');
        await ctx.answerCbQuery();
        for (const tags of groups) {
            await ctx.reply(await subscribe(ctx.chat.id, tags, ctx.match[1]), { parse_mode: 'HTML' });
        }
    });

    async function showSubs(ctx, edit = false) {
        const subs = await userData.subscriptions.list(ctx.chat.id);
        const text = subs.length
            ? [`🔔 <b>Твои подписки</b> (рассылка каждый день после ${hour}:00):`,
                ...subs.map((s, i) => `${i + 1}. <code>${escapeHtml(s.tags.join(' + '))}</code> — ${ratingLabel(s.rating)}`),
                '', 'Нажми ❌N, чтобы отписаться.'].join('\n')
            : '🔕 Подписок нет.\nПодписаться: <code>/sub hatsune miku</code> или кнопка 🔔 после поиска.';
        const del = subs.map((_, i) => Markup.button.callback(`❌${i + 1}`, `us:${i}`));
        const rows = [del.slice(0, 5), del.slice(5)];
        if (subs.length) rows.push([Markup.button.callback('📬 Проверить сейчас', 'subnow')]);
        const extra = { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows.filter(r => r.length)) };
        return edit ? ctx.editMessageText(text, extra).catch(() => {}) : ctx.reply(text, extra);
    }

    bot.command(['subs', 'unsub'], (ctx) => showSubs(ctx));

    bot.action(/^us:(\d+)$/, async (ctx) => {
        const removed = await userData.subscriptions.removeAt(ctx.chat.id, Number(ctx.match[1]));
        await ctx.answerCbQuery(removed ? `🔕 Отписался от ${removed.tags.join(' + ')}` : 'Уже удалено');
        await showSubs(ctx, true);
    });

    bot.action('subnow', async (ctx) => {
        const chatId = ctx.chat.id;
        const started = runner.startTask(ctx, async () => {
            const delivered = await deliverForChat({ ...deps, telegram: ctx.telegram }, chatId);
            if (!delivered) await ctx.telegram.sendMessage(chatId, '📭 Пока ничего нового по подпискам.');
        });
        await ctx.answerCbQuery(started ? '📬 Проверяю…' : BUSY_TEXT);
    });
}
