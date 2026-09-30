import { parseUserInput } from '../../utils/query.js';
import { DEFAULT_RATING, RATINGS, RATING_KEYWORDS, isNsfwTag, ratingLabel } from '../../utils/ratings.js';
import { escapeHtml } from '../../utils/format.js';
import { describeRating, formatGroupLine, parseGroupsFromMessage, searchKeyboard } from '../request.js';
import { BUSY_TEXT } from '../searchRunner.js';

export function registerSearchHandlers(bot, deps) {
    const { client, config, runner } = deps;
    const { counts } = config.search;
    const { startSearch, startTask, sendResults, skipFor } = runner;

    // Переключение рейтинга
    bot.action(/^r:(\w+)$/, async (ctx) => {
        const rating = ctx.match[1];
        if (!RATINGS[rating]) return ctx.answerCbQuery();
        await ctx.answerCbQuery(ratingLabel(rating));

        const text = ctx.callbackQuery.message?.text ?? '';
        const updated = text.replace(/^Рейтинг: .*$/m, describeRating(rating));
        const groups = parseGroupsFromMessage(text);
        // Переформатируем, чтобы сохранить <code> и счётчики
        const html = updated
            .split('\n')
            .map(line => line.startsWith('🔹') ? formatGroupLine(groups.shift() ?? []) : escapeHtml(line))
            .join('\n');

        // Кнопка «Подписаться» есть только под итоговым сообщением — сохраняем её
        const subscribe = JSON.stringify(ctx.callbackQuery.message?.reply_markup ?? {}).includes('"sub:');
        const keyboard = searchKeyboard(rating, counts, { subscribe });
        await ctx.editMessageText(html, { parse_mode: 'HTML', ...keyboard })
            .catch(() => ctx.editMessageReplyMarkup(keyboard.reply_markup).catch(() => {}));
    });

    // Запуск поиска
    bot.action(/^s:(\w+):(\d+)$/, async (ctx) => {
        const rating = RATINGS[ctx.match[1]] ? ctx.match[1] : DEFAULT_RATING;
        const count = Math.min(Number(ctx.match[2]), Math.max(...counts));
        const groups = parseGroupsFromMessage(ctx.callbackQuery.message?.text);

        if (!groups.length) {
            return ctx.answerCbQuery('Запрос устарел — напиши его заново', { show_alert: true });
        }
        if (!startSearch(ctx, groups, rating, count)) {
            return ctx.answerCbQuery(BUSY_TEXT);
        }
        await ctx.answerCbQuery(`🔍 Ищу ${count} шт.`);
    });

    // /random [nsfw|safe|sensitive|any] — случайная картинка
    bot.command('random', async (ctx) => {
        const arg = ctx.payload?.trim().toLowerCase();
        const rating = RATING_KEYWORDS[arg] ?? DEFAULT_RATING;
        if (!startSearch(ctx, [[{ name: 'score:>20', meta: true, postCount: 0 }]], rating, 1, { finalKeyboard: false })) {
            return ctx.reply(BUSY_TEXT);
        }
    });

    // /top [week|month] [nsfw] — популярное на Danbooru
    bot.command('top', async (ctx) => {
        const args = (ctx.payload || '').toLowerCase().split(/\s+/).filter(Boolean);
        const scale = args.includes('month') ? 'month' : args.includes('week') ? 'week' : 'day';
        const rating = args.map(a => RATING_KEYWORDS[a]).find(Boolean) ?? DEFAULT_RATING;
        const code = RATINGS[rating].code;

        const started = startTask(ctx, async () => {
            const skip = await skipFor(ctx.chat.id);
            const posts = (await client.popular({ scale }))
                .filter(p => !code || p.rating === code)
                .filter(p => !skip(p));
            const sent = await sendResults(ctx.telegram, ctx.chat.id, posts, 5);
            if (!sent) await ctx.reply('😔 Ничего нового в топе с таким рейтингом.');
        });
        if (!started) return ctx.reply(BUSY_TEXT);
    });
}

/**
 * Текст от пользователя → разбор → подтверждение с кнопками.
 * Регистрируется последним, чтобы не перехватывать команды и другие обработчики.
 */
export function registerTextSearch(bot, deps) {
    const { resolver, config } = deps;
    const { counts, maxGroups, maxTermsPerGroup } = config.search;

    bot.on('text', async (ctx, next) => {
        if (ctx.chat.type !== 'private') return next();
        const text = ctx.message.text.trim();
        if (text.startsWith('/')) {
            return ctx.reply('🤔 Не знаю такую команду. Смотри /help');
        }

        const parsed = parseUserInput(text, { maxGroups, maxTerms: maxTermsPerGroup });
        if (!parsed.groups.length) {
            return ctx.reply(
                parsed.rating
                    ? `Ок, ${ratingLabel(parsed.rating)}. А что искать? Напиши персонажа, тайтл или теги.`
                    : 'Напиши, что хочешь увидеть: персонажа, тайтл или теги через запятую. Подробнее — /help'
            );
        }

        ctx.sendChatAction('typing').catch(() => {});
        const status = await ctx.reply('🧠 Разбираю запрос…');

        let resolved;
        try {
            resolved = await Promise.all(parsed.groups.map(resolver.resolveGroup));
        } catch (error) {
            console.error('❌ Ошибка разбора тегов:', error);
            return ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined,
                error?.isRateLimit ? '⏳ Danbooru просит подождать. Попробуй через минуту.' : `⚠️ Ошибка: ${error.message}`);
        }

        const found = resolved.filter(g => g.tags.some(t => !t.negated));
        const lines = [];
        for (const group of resolved) {
            if (group.unresolved.length) {
                lines.push(`❌ Не нашёл: ${group.unresolved.map(u => `<code>${escapeHtml(u)}</code>`).join(', ')}`);
            }
        }

        if (!found.length) {
            lines.push('', 'Попробуй написать по-английски или ромадзи, например <code>hatsune miku</code>, <code>naruto</code>.');
            return ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined, lines.join('\n'), { parse_mode: 'HTML' });
        }

        const rating = parsed.rating
            ?? (found.some(g => g.tags.some(t => !t.negated && isNsfwTag(t.name))) ? 'explicit' : DEFAULT_RATING);

        const message = [
            '🔎 Понял так:',
            ...found.map(g => formatGroupLine(g.tags)),
            ...lines,
            '',
            describeRating(rating),
            'Сколько картинок прислать?'
        ].join('\n');

        await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined, message, {
            parse_mode: 'HTML',
            ...searchKeyboard(rating, counts)
        });
    });
}
