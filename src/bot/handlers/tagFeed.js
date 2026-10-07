import { escapeHtml } from '../../utils/format.js';
import { isMetatag } from '../../utils/query.js';
import { RATINGS } from '../../utils/ratings.js';
import { decodeTagPayload } from '../../utils/tagLinks.js';
import { MIX_MARK, parseGroupsFromMessage } from '../request.js';
import { BUSY_TEXT } from '../searchRunner.js';

const toTag = (raw) => {
    const negated = raw.startsWith('-');
    const name = negated ? raw.slice(1) : raw;
    return { name, negated, meta: isMetatag(name), postCount: 0 };
};

/**
 * Лента по тегу: клик по тегу в подписи (ссылка t.me/бот?start=t…) переключает
 * выдачу на этот тег — без глобального поиска хэштега в Telegram.
 * Под итогом — «🔀 Смешать» с прошлым запросом: так можно уточнять ленту
 * (miku → клик по «maid» → miku + maid) и гулять от тега к тегу.
 */
export function registerTagFeed(bot, { userData, config, runner }) {
    const { maxTermsPerGroup } = config.search;

    bot.start(async (ctx, next) => {
        const link = decodeTagPayload(ctx.payload);
        if (!link) return next();
        // Убираем «/start …», который Telegram отправил от имени пользователя
        ctx.deleteMessage().catch(() => {});

        const [previous] = await userData.history.list(ctx.chat.id);
        await userData.history.add(ctx.chat.id, [link.tag]);
        const mixWith = previous && !previous.includes(link.tag) && previous.length < maxTermsPerGroup
            ? previous.map(toTag)
            : undefined;

        const started = runner.startDefaultSearch(ctx, [[{ name: link.tag, postCount: 0 }]], {
            ...(link.rating ? { rating: link.rating } : {}),
            header: `🏷 <b>Лента:</b> ${escapeHtml(link.tag.replace(/_/g, ' '))}`,
            mixWith
        });
        if (!started) await ctx.reply(BUSY_TEXT);
    });

    // 🔀 Смешать: тег ленты + прошлый запрос в один поиск
    bot.action(/^mix:(\w+)$/, async (ctx) => {
        const rating = RATINGS[ctx.match[1]] ? ctx.match[1] : undefined;
        const text = ctx.callbackQuery.message?.text;
        const [current = []] = parseGroupsFromMessage(text);
        const [previous = []] = parseGroupsFromMessage(text, MIX_MARK);
        const tags = [...previous, ...current]
            .filter((tag, index, all) => all.findIndex(t => t.name === tag.name) === index)
            .slice(0, maxTermsPerGroup);
        if (!current.length || !previous.length) {
            return ctx.answerCbQuery('Запрос устарел — нажми на тег ещё раз', { show_alert: true });
        }

        await userData.history.add(ctx.chat.id, tags.map(t => `${t.negated ? '-' : ''}${t.name}`));
        if (!runner.startDefaultSearch(ctx, [tags], rating ? { rating } : {})) {
            return ctx.answerCbQuery(BUSY_TEXT);
        }
        await ctx.answerCbQuery(`🔀 ${tags.map(t => t.name).join(' + ')}`);
    });
}
