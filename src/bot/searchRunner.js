import { findPosts } from '../services/postSearch.js';
import { isFatalTelegramError, sendAlbum, sendPost } from '../services/sender.js';
import { enforceSafe, isAdult, ratingFromCode, ratingLabel } from '../utils/ratings.js';
import { escapeHtml } from '../utils/format.js';
import { tagLinker } from '../utils/tagLinks.js';
import { describeRating, formatGroupLine, formatMixLine, postKeyboard, searchKeyboard } from './request.js';
import { hourlyQuota, recordSent, seenFor, tryLock, unlock } from './chatState.js';

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

export const limitText = (minutes) =>
    `⏳ Ты посмотрел много картинок за последний час. Передохни ~${minutes} мин — и продолжим!`;

export const BUSY_TEXT = '⏳ Подожди, ещё отправляю предыдущие картинки';

const ALBUM_SIZE = 10;
// Без звука: уведомление даёт только первая картинка пачки
const SILENT = { disable_notification: true };

const shorten = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Общая логика поиска и отправки картинок пользователю.
 */
export function createSearchRunner({ client, config, userData, runTask }) {
    const { counts, sendDelayMs, hourlyLimit } = config.search;
    const limitFor = (chatId) => (config.adminIds.includes(chatId) ? 0 : hourlyLimit);
    const tagLimit = config.danbooru.tagLimit;
    const albumFrom = config.search.albumFrom ?? ALBUM_SIZE;
    // Имя бота — для ссылок-тегов в подписи (берётся из первого апдейта, см. createBot)
    let botUsername = null;
    const rememberBot = (botInfo) => {
        if (botInfo?.username) botUsername = botInfo.username;
    };

    /** Фильтр: уже видел, есть тег из блок-листа или 18+ в безопасном режиме. */
    async function skipFor(chatId) {
        const seen = seenFor(chatId);
        const blocked = await userData.blocklist.matcher(chatId);
        const { safe } = await userData.settings.get(chatId);
        const skip = (post) => seen.has(post.md5) || blocked(post) || (safe && isAdult(post));
        // С фильтрами часть постов отсеется — берём у Danbooru побольше
        skip.strict = blocked.active || safe;
        return skip;
    }

    /**
     * Отправляет посты: по одному с кнопками или альбомами по 10 (albums).
     * Звук — только у первого сообщения, остальные приходят тихо.
     * @param {string} [options.rating] — рейтинг ленты для ссылок-тегов (иначе — рейтинг поста)
     * @returns число отправленных
     */
    async function sendResults(telegram, chatId, posts, count, { query, header, rating, albums = false } = {}) {
        const seen = seenFor(chatId);
        const linkFor = (post) => tagLinker(botUsername, rating ?? ratingFromCode(post.rating));
        let sent = 0;
        const delivered = (post) => {
            seen.add(post.md5);
            recordSent(chatId);
            sent++;
        };
        const limitReached = async () => {
            const quota = hourlyQuota(chatId, limitFor(chatId));
            if (quota.limited) await telegram.sendMessage(chatId, limitText(quota.retryInMinutes));
            return quota.limited;
        };
        const sendOne = async (post) => {
            const message = await withTelegramRetry(() => sendPost(telegram, chatId, post, {
                client,
                userAgent: config.danbooru.userAgent,
                query,
                header: sent === 0 ? header : undefined,
                tagLink: linkFor(post),
                extra: { ...postKeyboard(post, client.baseUrl), ...(sent > 0 ? SILENT : {}) }
            }));
            if (message) delivered(post);
            return Boolean(message);
        };
        const sendBatch = async (batch) => {
            try {
                return await withTelegramRetry(() => sendAlbum(telegram, chatId, batch, {
                    client,
                    userAgent: config.danbooru.userAgent,
                    header: sent === 0 ? header : undefined,
                    tagLink: linkFor(batch[0]),
                    extra: sent > 0 ? SILENT : undefined
                }));
            } catch (error) {
                if (isFatalTelegramError(error)) throw error;
                console.warn(`⚠️ Альбом не ушёл, шлю по одной: ${error.message}`);
                return [];
            }
        };

        let index = 0;
        while (sent < count && index < posts.length) {
            if (await limitReached()) break;
            if (!albums || count - sent < 2) {
                const ok = await sendOne(posts[index++]);
                if (ok && sent < count) await sleep(sendDelayMs);
                continue;
            }
            const batch = posts.slice(index, index + Math.min(ALBUM_SIZE, count - sent));
            index += batch.length;
            const inAlbum = new Set((batch.length >= 2 ? await sendBatch(batch) : []).map(item => item.post));
            for (const post of inAlbum) delivered(post);
            // Что не попало в альбом (гифки, сбой альбома) — по одной
            for (const post of batch) {
                if (inAlbum.has(post) || sent >= count) continue;
                if (await limitReached()) return sent;
                await sendOne(post);
            }
            if (sent < count) await sleep(sendDelayMs);
        }
        return sent;
    }

    /**
     * Ищет и отправляет картинки по группам тегов.
     * @param {Array} [options.mixWith] — прошлый запрос: под итогом появится «🔀 Смешать»
     */
    async function runSearch(telegram, chatId, groups, requestedRating, count, { finalKeyboard = true, header, mixWith } = {}) {
        const settings = await userData.settings.get(chatId);
        const { rating, changed } = enforceSafe(requestedRating, settings.safe);
        if (changed) {
            await telegram.sendMessage(chatId, '🔒 Включён безопасный режим — ищу только safe. Выключить: /settings');
        }
        const progress = await telegram.sendMessage(chatId, `🔍 Ищу… (${ratingLabel(rating)})`, SILENT);
        const skip = await skipFor(chatId);
        const albums = settings.albums && count >= albumFrom;

        try {
            for (const tags of groups) {
                const title = groupTitle(tags);
                const posts = await findPosts(client, { tags, rating, count, tagLimit, skip, limit: skip.strict ? 200 : undefined });
                const sent = await sendResults(telegram, chatId, posts, count, {
                    query: groups.length > 1 ? title.replace(/_/g, ' ') : undefined,
                    header,
                    rating,
                    albums
                });

                if (sent === 0) {
                    await telegram.sendMessage(chatId,
                        `😔 По <code>${escapeHtml(title)}</code> ничего нового не нашлось (${ratingLabel(rating)}).\n` +
                        'Попробуй другой рейтинг или убери часть тегов.',
                        { parse_mode: 'HTML' });
                } else if (sent < count) {
                    await telegram.sendMessage(chatId,
                        `ℹ️ По <code>${escapeHtml(title)}</code> нашлось только ${sent} из ${count}.`,
                        { parse_mode: 'HTML', ...SILENT });
                }
            }
        } catch (error) {
            await reportError(telegram, chatId, error);
        } finally {
            await telegram.deleteMessage(chatId, progress.message_id).catch(() => {});
        }

        if (finalKeyboard && groups.some(tags => tags.length)) {
            const mix = mixWith?.length
                ? `🔀 Смешать с «${shorten(groupTitle(mixWith), 30)}»`
                : undefined;
            await telegram.sendMessage(chatId,
                ['✅ Готово! Хочешь ещё?', ...groups.map(formatGroupLine), ...(mix ? [formatMixLine(mixWith)] : []), describeRating(rating)].join('\n'),
                { parse_mode: 'HTML', ...SILENT, ...searchKeyboard(rating, counts, { subscribe: true, mix }) });
        }
    }

    /**
     * Запускает долгую задачу для чата в фоне (одна задача на чат).
     * @returns {boolean} false — чат уже занят
     */
    function startTask(ctx, task) {
        const chatId = ctx.chat.id;
        if (!tryLock(chatId)) return false;
        const quota = hourlyQuota(chatId, limitFor(chatId));
        if (quota.limited) {
            // Сообщаем о лимите вместо задачи
            task = () => ctx.telegram.sendMessage(chatId, limitText(quota.retryInMinutes));
        }
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

    /** Поиск с настройками пользователя (рейтинг и количество по умолчанию). */
    function startDefaultSearch(ctx, groups, options = {}) {
        return startTask(ctx, async () => {
            const settings = await userData.settings.get(ctx.chat.id);
            await runSearch(ctx.telegram, ctx.chat.id, groups, options.rating ?? settings.rating, settings.count, options);
        });
    }

    return { runSearch, startSearch, startDefaultSearch, startTask, sendResults, skipFor, rememberBot };
}

export async function reportError(telegram, chatId, error) {
    console.error('❌ Ошибка:', error);
    const text = error?.isRateLimit
        ? '⏳ Danbooru просит подождать. Попробуй через минуту.'
        : `⚠️ Ошибка: ${error?.message ?? error}`;
    await telegram.sendMessage(chatId, text).catch(() => {});
}
