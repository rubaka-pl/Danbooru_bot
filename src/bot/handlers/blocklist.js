import { Markup } from 'telegraf';
import { normalizeTag } from '../../utils/query.js';
import { escapeHtml } from '../../utils/format.js';

const splitArgs = (text) => (text || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);

/**
 * /block, /unblock, /blocklist — теги, которые пользователь никогда не хочет видеть.
 */
export function registerBlocklist(bot, { resolver, userData }) {
    async function showList(ctx, edit = false) {
        const tags = await userData.blocklist.list(ctx.chat.id);
        const text = tags.length
            ? `🚫 <b>Блок-лист</b> — картинки с этими тегами никогда не покажу:\n${tags.map((t, i) => `${i + 1}. <code>${escapeHtml(t)}</code>`).join('\n')}\n\nНажми ❌N, чтобы разблокировать.`
            : '🚫 Блок-лист пуст.\nДобавить: <code>/block yaoi, guro</code>';
        const buttons = tags.slice(0, 30).map((_, i) => Markup.button.callback(`❌${i + 1}`, `ub:${i}`));
        const rows = [];
        for (let i = 0; i < buttons.length; i += 6) rows.push(buttons.slice(i, i + 6));
        const extra = { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) };
        return edit ? ctx.editMessageText(text, extra).catch(() => {}) : ctx.reply(text, extra);
    }

    bot.command('block', async (ctx) => {
        const terms = splitArgs(ctx.payload);
        if (!terms.length) {
            return ctx.reply('Напиши, какие теги скрывать: <code>/block yaoi, guro, male focus</code>', { parse_mode: 'HTML' });
        }

        const tags = [];
        const unknown = [];
        for (const term of terms) {
            const name = normalizeTag(term);
            const found = await resolver.resolve(name).catch(() => []);
            // Для блок-листа важна точность: берём найденный тег или то, что ввёл пользователь
            if (found.length === 1) tags.push(found[0].name);
            else if (found.length > 1) tags.push(name);
            else unknown.push(term);
        }

        const added = await userData.blocklist.add(ctx.chat.id, tags);
        const lines = [];
        if (added.length) lines.push(`🚫 Заблокировано: ${added.map(t => `<code>${escapeHtml(t)}</code>`).join(', ')}`);
        if (tags.length && !added.length) lines.push('Эти теги уже в блок-листе.');
        if (unknown.length) lines.push(`❓ Не нашёл тег: ${unknown.map(t => `<code>${escapeHtml(t)}</code>`).join(', ')}`);
        await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
    });

    bot.command('unblock', async (ctx) => {
        const names = splitArgs(ctx.payload).map(normalizeTag);
        if (!names.length) return showList(ctx);
        const removed = await userData.blocklist.remove(ctx.chat.id, names);
        await ctx.reply(removed ? `✅ Разблокировано: ${removed}` : 'Таких тегов нет в блок-листе. Смотри /blocklist');
    });

    bot.command('blocklist', (ctx) => showList(ctx));

    bot.action(/^ub:(\d+)$/, async (ctx) => {
        const tags = await userData.blocklist.list(ctx.chat.id);
        const tag = tags[Number(ctx.match[1])];
        if (tag) await userData.blocklist.remove(ctx.chat.id, [tag]);
        await ctx.answerCbQuery(tag ? `✅ ${tag} разблокирован` : 'Уже удалено');
        await showList(ctx, true);
    });
}
