import { Markup } from 'telegraf';
import { normalizeTag } from '../../utils/query.js';
import { escapeHtml, formatCount, humanizeTag } from '../../utils/format.js';
import { dtextToPlain } from '../../utils/dtext.js';
import { describeRating, formatGroupLine, searchKeyboard } from '../request.js';

const CATEGORY = { 0: '🏷 Тег', 1: '🎨 Автор', 3: '📺 Тайтл', 4: '👤 Персонаж', 5: '📎 Мета' };

/**
 * /info <тег> — что это за персонаж/тайтл/автор: вики, число артов, похожие теги.
 */
export function registerInfo(bot, { client, resolver, config, userData }) {
    const { counts } = config.search;

    bot.command('info', async (ctx) => {
        const query = normalizeTag(ctx.payload || '');
        if (!query) {
            return ctx.reply('Напиши, про что рассказать: <code>/info frieren</code>', { parse_mode: 'HTML' });
        }

        const [tag] = await resolver.resolve(query).catch(() => []);
        if (!tag) {
            const suggestions = await resolver.suggest(query).catch(() => []);
            return ctx.reply(
                `❌ Не нашёл тег <code>${escapeHtml(query)}</code>`,
                {
                    parse_mode: 'HTML',
                    ...(suggestions.length
                        ? Markup.inlineKeyboard(suggestions.map(s => [Markup.button.callback(`💡 ${s.name}`, `st:${s.name}`)]))
                        : {})
                }
            );
        }

        const [wiki, related] = await Promise.all([
            client.wiki(tag.name).catch(() => null),
            client.relatedTags(tag.name, { limit: 12 }).catch(() => [])
        ]);
        const { rating } = await userData.settings.get(ctx.chat.id);

        const otherNames = (wiki?.other_names ?? []).slice(0, 5);
        const description = dtextToPlain(wiki?.body);
        const relatedShown = related.filter(r => r.category === 4 || r.category === 3 || r.category === 1).slice(0, 6);
        const relatedList = (relatedShown.length ? relatedShown : related.slice(0, 6));

        const text = [
            `ℹ️ <b>${escapeHtml(humanizeTag(tag.name))}</b>`,
            `${CATEGORY[tag.category] ?? CATEGORY[0]} · 🖼 ${formatCount(tag.postCount)} артов`,
            otherNames.length && `🌐 Также: ${otherNames.map(escapeHtml).join(', ')}`,
            description && `\n${escapeHtml(description)}`,
            relatedList.length && `\n🔗 Связано: ${relatedList.map(r => `<code>${escapeHtml(r.name)}</code>`).join(', ')}`,
            '',
            formatGroupLine([tag]),
            describeRating(rating)
        ].filter(Boolean).join('\n');

        const keyboard = searchKeyboard(rating, counts, { subscribe: true }).reply_markup;
        const relatedButtons = relatedList
            .filter(r => Buffer.byteLength(`st:${r.name}`) <= 64)
            .map(r => Markup.button.callback(`🔗 ${humanizeTag(r.name)}`.slice(0, 40), `st:${r.name}`));
        for (let i = 0; i < relatedButtons.length; i += 2) keyboard.inline_keyboard.push(relatedButtons.slice(i, i + 2));

        await ctx.reply(text, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            reply_markup: keyboard
        });
    });
}
