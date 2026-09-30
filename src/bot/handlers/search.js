import { findPosts } from '../../services/postSearch.js';
import { sendPost } from '../../services/sender.js';
import { parseUserInput } from '../../utils/query.js';
import { DEFAULT_RATING, RATINGS, RATING_KEYWORDS, isNsfwTag, ratingLabel } from '../../utils/ratings.js';
import { escapeHtml } from '../../utils/format.js';
import { describeRating, formatGroupLine, parseGroupsFromMessage, searchKeyboard } from '../request.js';
import { seenFor, tryLock, unlock } from '../chatState.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const groupTitle = (tags) => tags.map(t => `${t.negated ? '-' : ''}${t.name}`).join(' + ') || 'случайное';

/** Повторяет вызов Telegram, если он попросил подождать (429). */
async function withTelegramRetry(fn) {
    try {
        return await fn();
    } catch (error) {
        const retryAfter = error?.response?.parameters?.retry_after;
        if (error?.response?.error_code !== 429 || !retryAfter) throw error;
        await sleep((retryAfter + 1) * 1000);
        return fn();
    }
}

export function registerSearchHandlers(bot, deps) {
    const { client, resolver, config, runTask } = deps;
    const { counts, sendDelayMs, maxGroups, maxTermsPerGroup } = config.search;
    const tagLimit = config.danbooru.tagLimit;

    /**
     * Ищет и отправляет картинки. Работает в фоне, чтобы не упираться в таймаут обработчика.
     */
    async function runSearch(telegram, chatId, groups, rating, count, { finalKeyboard = true } = {}) {
        const seen = seenFor(chatId);
        const progress = await telegram.sendMessage(chatId, `🔍 Ищу… (${ratingLabel(rating)})`);

        try {
            for (const tags of groups) {
                const title = groupTitle(tags);
                const posts = await findPosts(client, {
                    tags,
                    rating,
                    count,
                    tagLimit,
                    skip: (post) => seen.has(post.md5)
                });

                let sent = 0;
                for (const post of posts) {
                    if (sent >= count) break;
                    const ok = await withTelegramRetry(() => sendPost(telegram, chatId, post, {
                        client,
                        userAgent: config.danbooru.userAgent,
                        query: groups.length > 1 ? title.replace(/_/g, ' ') : undefined
                    }));
                    if (!ok) continue;
                    seen.add(post.md5);
                    sent++;
                    await sleep(sendDelayMs);
                }

                if (sent === 0) {
                    await telegram.sendMessage(chatId,
                        `😔 По <code>${escapeHtml(title)}</code> ничего нового не нашлось (${ratingLabel(rating)}).\n` +
                        'Попробуй другой рейтинг или убери часть тегов.',
                        { parse_mode: 'HTML' });
                } else if (sent < count) {
                    await telegram.sendMessage(chatId,
                        `ℹ️ По <code>${escapeHtml(title)}</code> нашлось только ${sent} из ${count}.`,
                        { parse_mode: 'HTML' });
                }
            }
        } catch (error) {
            console.error('❌ Ошибка поиска:', error);
            const text = error?.isRateLimit
                ? '⏳ Danbooru просит подождать. Попробуй через минуту.'
                : `⚠️ Ошибка при поиске: ${error.message}`;
            await telegram.sendMessage(chatId, text).catch(() => {});
        } finally {
            await telegram.deleteMessage(chatId, progress.message_id).catch(() => {});
        }

        if (finalKeyboard && groups.some(tags => tags.length)) {
            await telegram.sendMessage(chatId,
                ['✅ Готово! Хочешь ещё?', ...groups.map(formatGroupLine), describeRating(rating)].join('\n'),
                { parse_mode: 'HTML', ...searchKeyboard(rating, counts) });
        }
    }

    function startSearch(ctx, groups, rating, count, options) {
        const chatId = ctx.chat.id;
        if (!tryLock(chatId)) return false;
        runTask(
            runSearch(ctx.telegram, chatId, groups, rating, count, options)
                .catch(error => console.error('❌ Поиск упал:', error))
                .finally(() => unlock(chatId))
        );
        return true;
    }

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

        await ctx.editMessageText(html, { parse_mode: 'HTML', ...searchKeyboard(rating, counts) })
            .catch(() => ctx.editMessageReplyMarkup(searchKeyboard(rating, counts).reply_markup).catch(() => {}));
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
            return ctx.answerCbQuery('⏳ Подожди, ещё отправляю предыдущие картинки');
        }
        await ctx.answerCbQuery(`🔍 Ищу ${count} шт.`);
    });

    // /random [nsfw|safe|sensitive|any] — случайная картинка
    bot.command('random', async (ctx) => {
        const arg = ctx.payload?.trim().toLowerCase();
        const rating = RATING_KEYWORDS[arg] ?? DEFAULT_RATING;
        if (!startSearch(ctx, [[{ name: 'score:>20', meta: true, postCount: 0 }]], rating, 1, { finalKeyboard: false })) {
            return ctx.reply('⏳ Подожди, ещё отправляю предыдущие картинки');
        }
    });

    // /top [week|month] [nsfw] — популярное на Danbooru
    bot.command('top', async (ctx) => {
        const args = (ctx.payload || '').toLowerCase().split(/\s+/).filter(Boolean);
        const scale = args.includes('month') ? 'month' : args.includes('week') ? 'week' : 'day';
        const rating = args.map(a => RATING_KEYWORDS[a]).find(Boolean) ?? DEFAULT_RATING;
        const chatId = ctx.chat.id;
        if (!tryLock(chatId)) return ctx.reply('⏳ Подожди, ещё отправляю предыдущие картинки');

        runTask((async () => {
            try {
                const code = RATINGS[rating].code;
                const seen = seenFor(chatId);
                const posts = (await client.popular({ scale }))
                    .filter(p => !code || p.rating === code)
                    .filter(p => !seen.has(p.md5));
                let sent = 0;
                for (const post of posts) {
                    if (sent >= 5) break;
                    const ok = await withTelegramRetry(() => sendPost(ctx.telegram, chatId, post, {
                        client, userAgent: config.danbooru.userAgent
                    }));
                    if (!ok) continue;
                    seen.add(post.md5);
                    sent++;
                    await sleep(sendDelayMs);
                }
                if (!sent) await ctx.reply('😔 Ничего нового в топе с таким рейтингом.');
            } catch (error) {
                console.error('❌ /top:', error);
                await ctx.reply(`⚠️ Ошибка: ${error.message}`).catch(() => {});
            } finally {
                unlock(chatId);
            }
        })());
    });

    // Текст от пользователя → разбор → подтверждение с кнопками.
    // Регистрируется последним, чтобы не перехватывать команды.
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
