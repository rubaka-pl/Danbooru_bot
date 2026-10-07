import { Markup } from 'telegraf';
import { RATINGS, ratingLabel } from '../utils/ratings.js';
import { escapeHtml, formatCount } from '../utils/format.js';
import { isMetatag } from '../utils/query.js';
import { originalUrl } from '../utils/posts.js';

/*
 * Запрос хранится прямо в тексте сообщения бота (строки "🔹 ..."),
 * а рейтинг и количество — в callback-данных кнопок.
 * Благодаря этому кнопки работают даже после перезапуска бота
 * и в serverless-режиме (Vercel), где нет общей памяти.
 */

const LINE_MARK = '🔹';
// Строка «прошлого запроса» под лентой тега — для кнопки «🔀 Смешать»
export const MIX_MARK = '🔀';

function formatTag(tag) {
    const name = `${tag.negated ? '-' : ''}${tag.name}`;
    const countLabel = tag.countLabel ?? (tag.postCount ? formatCount(tag.postCount) : '');
    const count = !tag.meta && !tag.negated && countLabel ? ` (${countLabel})` : '';
    return `<code>${escapeHtml(name)}</code>${count}`;
}

/** Строка запроса. Теги отсортированы от редких к частым. */
export function formatGroupLine(tags) {
    const sorted = [...tags].sort((a, b) => (Number(!!a.negated) - Number(!!b.negated)) || (a.postCount - b.postCount));
    return `${LINE_MARK} ${sorted.map(formatTag).join(' + ')}`;
}

/** Строка «🔀 прошлый запрос» (без сортировки и счётчиков). */
export function formatMixLine(tags) {
    return `${MIX_MARK} ${tags.map(formatTag).join(' + ')}`;
}

/** Достаёт группы тегов обратно из текста сообщения (plain text). */
export function parseGroupsFromMessage(text = '', mark = LINE_MARK) {
    return text
        .split('\n')
        .filter(line => line.startsWith(mark))
        .map(line => line.slice(mark.length).trim())
        .map(line => line.split(' + ').map((item, index) => {
            const [raw, suffix] = item.trim().split(' ');
            const negated = raw.startsWith('-');
            const name = negated ? raw.slice(1) : raw;
            const countLabel = suffix?.match(/^\((.+)\)$/)?.[1];
            // postCount = позиция: теги в сообщении уже отсортированы от редких к частым
            return { name, negated, meta: isMetatag(name), postCount: index, countLabel };
        }).filter(tag => tag.name));
}

/** Кнопки по `size` в ряд. */
export function chunk(items, size) {
    const rows = [];
    for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
    return rows;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.subscribe] — кнопка «🔔 Подписаться»
 * @param {string} [options.mix] — подпись кнопки «🔀 Смешать с прошлым запросом»
 */
export function searchKeyboard(rating, counts, { subscribe = false, mix } = {}) {
    const ratingRow = Object.keys(RATINGS).map(key =>
        Markup.button.callback(`${key === rating ? '✅ ' : ''}${RATINGS[key].label}`, `r:${key}`)
    );
    const countButtons = counts.map(n => Markup.button.callback(`📥 ${n}`, `s:${rating}:${n}`));
    const rows = [ratingRow.slice(0, 2), ratingRow.slice(2), ...chunk(countButtons, 3)];
    if (mix) rows.push([Markup.button.callback(mix, `mix:${rating}`)]);
    if (subscribe) rows.push([Markup.button.callback('🔔 Подписаться на новые', `sub:${rating}`)]);
    return Markup.inlineKeyboard(rows);
}

export function describeRating(rating) {
    return `Рейтинг: ${ratingLabel(rating)}`;
}

/** Кнопки под картинкой. */
export function postKeyboard(post, baseUrl = 'https://danbooru.donmai.us') {
    const hasArtist = Boolean(post.tag_string_artist?.trim());
    const hasCharacter = Boolean(post.tag_string_character?.trim());
    const original = originalUrl(post, baseUrl);
    const row2 = [
        hasArtist && Markup.button.callback('🎨 Ещё автора', `art:${post.id}`),
        hasCharacter && Markup.button.callback('👤 Ещё персонажа', `chr:${post.id}`)
    ].filter(Boolean);
    return Markup.inlineKeyboard([
        [Markup.button.callback('❤️', `f:${post.id}`), Markup.button.callback('🔍 Похожие', `sim:${post.id}`)],
        [
            // Открывает картинку в полном разрешении (в браузере / встроенном просмотре Telegram)
            ...(original ? [Markup.button.url('🖼 View original', original)] : []),
            Markup.button.callback('📥 Файлом', `dl:${post.id}`)
        ],
        ...(row2.length ? [row2] : []),
        // Открывает выбор чата и вставляет «@бот id:123» — друг увидит именно этот арт
        [Markup.button.switchToChat('📤 Поделиться', `id:${post.id}`)]
    ]);
}

/** Кнопка под постом в канале (в каналах работают только URL-кнопки). */
export function channelKeyboard(post, baseUrl = 'https://danbooru.donmai.us') {
    const original = originalUrl(post, baseUrl);
    return original ? Markup.inlineKeyboard([[Markup.button.url('🖼 View original', original)]]) : {};
}
