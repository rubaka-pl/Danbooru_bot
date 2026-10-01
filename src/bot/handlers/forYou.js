import { escapeHtml, humanizeTag } from '../../utils/format.js';
import { BUSY_TEXT } from '../searchRunner.js';

const splitTags = (value) => (value || '').split(' ').filter(Boolean);

/**
 * Любимые теги по избранному: персонажи, тайтлы и авторы, отсортированные по частоте.
 * @returns {Array<{ tag: string, count: number }>}
 */
export function favoriteTags(posts) {
    const counts = new Map();
    for (const post of posts) {
        const tags = [
            ...splitTags(post.tag_string_character),
            ...splitTags(post.tag_string_copyright).filter(t => t !== 'original'),
            ...splitTags(post.tag_string_artist)
        ];
        for (const tag of new Set(tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);
}

/** Случайный тег из топа (чем чаще встречается — тем вероятнее). */
export function pickWeighted(items, random = Math.random) {
    const total = items.reduce((sum, item) => sum + item.count, 0);
    let roll = random() * total;
    for (const item of items) {
        roll -= item.count;
        if (roll < 0) return item;
    }
    return items[0];
}

/**
 * /foryou — рекомендации на основе избранного.
 */
export function registerForYou(bot, { client, userData, runner }) {
    bot.command('foryou', async (ctx) => {
        const chatId = ctx.chat.id;
        const started = runner.startTask(ctx, async () => {
            const ids = (await userData.favorites.list(chatId)).slice(0, 60);
            if (!ids.length) {
                await ctx.telegram.sendMessage(chatId, '✨ Сначала добавь что-нибудь в избранное (❤️ под картинками) — и я подберу похожее.');
                return;
            }
            const top = favoriteTags(await client.postsByIds(ids)).slice(0, 10);
            if (!top.length) {
                await ctx.telegram.sendMessage(chatId, '✨ Не получилось понять твой вкус — добавь в избранное побольше артов.');
                return;
            }
            const { tag } = pickWeighted(top);
            const { rating, count } = await userData.settings.get(chatId);
            await runner.runSearch(ctx.telegram, chatId, [[{ name: tag, postCount: 0 }]], rating, count, {
                header: `✨ <b>Для тебя:</b> ${escapeHtml(humanizeTag(tag))}`
            });
        });
        if (!started) await ctx.reply(BUSY_TEXT);
    });
}
