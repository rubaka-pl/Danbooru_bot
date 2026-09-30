import { escapeHtml, humanizeTag } from '../utils/format.js';
import { minutesInZone } from '../utils/quietHours.js';
import { dateInZone } from './subscriptions.js';

const LAST_RECAP_KEY = 'ch:recap:last';
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Ссылка на сообщение канала: @name → t.me/name/ID, -100123 → t.me/c/123/ID */
export function channelLink(channelId, messageId) {
    const id = String(channelId);
    if (id.startsWith('@')) return `https://t.me/${id.slice(1)}/${messageId}`;
    if (id.startsWith('-100')) return `https://t.me/c/${id.slice(4)}/${messageId}`;
    return null;
}

export function weekdayInZone(date, timeZone) {
    return WEEKDAYS[new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date)];
}

/** Текст «Топ недели». */
export function formatRecap(best, channelId) {
    const medals = ['🥇', '🥈', '🥉'];
    return [
        '🏆 <b>Топ недели по вашим реакциям</b>',
        '',
        ...best.map((item, i) => {
            const title = escapeHtml(humanizeTag(item.tags?.[0] ?? `пост ${item.postId}`));
            const link = channelLink(channelId, item.messageId);
            return `${medals[i] ?? `${i + 1}.`} ${link ? `<a href="${link}">${title}</a>` : title} — ❤️ ${item.reactions}`;
        }),
        '',
        'Ставьте реакции — бот подбирает посты по вашему вкусу 💫'
    ].join('\n');
}

/**
 * Публикует «Топ недели», если пришло время (день недели и час из конфига).
 * @returns {Promise<'disabled'|'not_due'|'empty'|'posted'>}
 */
export async function runRecapIfDue({ telegram, config, channelStats, store }, { now = new Date(), force = false } = {}) {
    const { enabled, weekday, hour, timeZone } = config.recap;
    if (!enabled && !force) return 'disabled';

    const today = dateInZone(now, timeZone);
    if (!force) {
        if (weekdayInZone(now, timeZone) !== weekday) return 'not_due';
        if (minutesInZone(now, timeZone) < hour * 60) return 'not_due';
        if ((await store.get(LAST_RECAP_KEY)) === today) return 'not_due';
    }
    await store.set(LAST_RECAP_KEY, today);

    const best = await channelStats.bestPosts({ days: 7, limit: 5, now: now.getTime() });
    if (!best.length) return 'empty';

    await telegram.sendMessage(config.autopost.channelId, formatRecap(best, config.autopost.channelId), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
    });
    console.log(`🏆 Топ недели опубликован (${best.length} постов)`);
    return 'posted';
}
