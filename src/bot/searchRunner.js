import { findPosts } from '../services/postSearch.js';
import { sendPost } from '../services/sender.js';
import { ratingLabel } from '../utils/ratings.js';
import { escapeHtml } from '../utils/format.js';
import { describeRating, formatGroupLine, postKeyboard, searchKeyboard } from './request.js';
import { seenFor, tryLock, unlock } from './chatState.js';

export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const groupTitle = (tags) => tags.map(t => `${t.negated ? '-' : ''}${t.name}`).join(' + ') || 'случайное';

/** Повторяет вызов Telegram, если он попросил подождать (429). */
export async function withTelegramRetry(fn) {
    try {
        return await fn();
    } catch (error) {
        const retryAfter = error?.response?.parameters?.retry_after;
        if (error?.response?.error_code !== 429 || retryAfter == null) throw error;
        await sleep((retryAfter + 1) * 1000);
        return fn();
    }
}

export const BUSY_TEXT = '⏳ Подожди, ещё отправляю предыдущие картинки';

/**
 * Общая логика поиска и отправки картинок пользователю.
 */
export function createSearchRunner({ client, config, userData, runTask }) {
    const { counts, sendDelayMs } = config.search;
    const tagLimit = config.danbooru.tagLimit;

    /** Фильтр: уже видел или есть тег из блок-листа. */
    async function skipFor(chatId) {
        const seen = seenFor(chatId);
        const blocked = await userData.blocklist.matcher(chatId);
        return (post) => seen.has(post.md5) || blocked(post);
    }

    /** Отправляет посты по одному с кнопками. @returns число отправленных */
    async function sendResults(telegram, chatId, posts, count, { query, header } = {}) {
        const seen = seenFor(chatId);
        let sent = 0;
        for (const post of posts) {
            if (sent >= count) break;
            const message = await withTelegramRetry(() => sendPost(telegram, chatId, post, {
                client,
                userAgent: config.danbooru.userAgent,
                query,
                header: sent === 0 ? header : undefined,
                extra: postKeyboard(post)
            }));
            if (!message) continue;
            seen.add(post.md5);
            sent++;
            if (sent < count) await sleep(sendDelayMs);
        }
        return sent;
    }

    /**
     * Ищет и отправляет картинки по группам тегов.
     */
    async function runSearch(telegram, chatId, groups, rating, count, { finalKeyboard = true, header } = {}) {
        const progress = await telegram.sendMessage(chatId, `🔍 Ищу… (${ratingLabel(rating)})`);
        const skip = await skipFor(chatId);

        try {
            for (const tags of groups) {
                const title = groupTitle(tags);
                const posts = await findPosts(client, { tags, rating, count, tagLimit, skip });
                const sent = await sendResults(telegram, chatId, posts, count, {
                    query: groups.length > 1 ? title.replace(/_/g, ' ') : undefined,
                    header
                });

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
            await reportError(telegram, chatId, error);
        } finally {
            await telegram.deleteMessage(chatId, progress.message_id).catch(() => {});
        }

        if (finalKeyboard && groups.some(tags => tags.length)) {
            await telegram.sendMessage(chatId,
                ['✅ Готово! Хочешь ещё?', ...groups.map(formatGroupLine), describeRating(rating)].join('\n'),
                { parse_mode: 'HTML', ...searchKeyboard(rating, counts, { subscribe: true }) });
        }
    }

    /**
     * Запускает долгую задачу для чата в фоне (одна задача на чат).
     * @returns {boolean} false — чат уже занят
     */
    function startTask(ctx, task) {
        const chatId = ctx.chat.id;
        if (!tryLock(chatId)) return false;
        runTask(
            Promise.resolve()
                .then(task)
                .catch(error => reportError(ctx.telegram, chatId, error))
                .finally(() => unlock(chatId))
        );
        return true;
    }

    function startSearch(ctx, groups, rating, count, options) {
        return startTask(ctx, () => runSearch(ctx.telegram, ctx.chat.id, groups, rating, count, options));
    }

    return { runSearch, startSearch, startTask, sendResults, skipFor };
}

export async function reportError(telegram, chatId, error) {
    console.error('❌ Ошибка:', error);
    const text = error?.isRateLimit
        ? '⏳ Danbooru просит подождать. Попробуй через минуту.'
        : `⚠️ Ошибка: ${error?.message ?? error}`;
    await telegram.sendMessage(chatId, text).catch(() => {});
}
