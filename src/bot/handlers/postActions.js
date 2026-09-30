import { ratingFromCode } from '../../utils/ratings.js';
import { BUSY_TEXT } from '../searchRunner.js';
import { sendOriginal } from '../../services/sender.js';

const firstTag = (value) => (value || '').split(' ').filter(Boolean)[0] ?? null;

/**
 * Кнопки под картинкой: ❤️, «ещё автора», «ещё персонажа», «похожие».
 */
export function registerPostActions(bot, { client, config, userData, runner }) {
    // 📥 Оригинал файлом
    bot.action(/^dl:(\d+)$/, async (ctx) => {
        const postId = Number(ctx.match[1]);
        const started = runner.startTask(ctx, async () => {
            const post = await client.post(postId);
            const result = await sendOriginal(ctx.telegram, ctx.chat.id, post, { client, userAgent: config.danbooru.userAgent });
            if (result === 'unavailable') {
                await ctx.telegram.sendMessage(ctx.chat.id, '🔒 Оригинал этого поста недоступен без аккаунта Danbooru.');
            }
        });
        await ctx.answerCbQuery(started ? '📥 Отправляю оригинал…' : BUSY_TEXT);
    });

    // ❤️ Избранное
    bot.action(/^f:(\d+)$/, async (ctx) => {
        const postId = Number(ctx.match[1]);
        const added = await userData.favorites.toggle(ctx.chat.id, postId);
        await ctx.answerCbQuery(added ? '❤️ Добавлено в избранное (/favs)' : '💔 Убрано из избранного');
    });

    // Ещё этого автора / персонажа
    const moreByTag = (field, label) => async (ctx) => {
        const postId = Number(ctx.match[1]);
        let post;
        try {
            post = await client.post(postId);
        } catch (error) {
            return ctx.answerCbQuery(`⚠️ ${error.message}`);
        }
        const tag = firstTag(post[field]);
        if (!tag) return ctx.answerCbQuery(`У этой картинки нет тега «${label}»`);

        const groups = [[{ name: tag, postCount: post.tag_count ?? 0 }]];
        if (!runner.startSearch(ctx, groups, ratingFromCode(post.rating), 3)) {
            return ctx.answerCbQuery(BUSY_TEXT);
        }
        await ctx.answerCbQuery(`🔍 Ищу: ${tag}`);
    };

    bot.action(/^art:(\d+)$/, moreByTag('tag_string_artist', 'автор'));
    bot.action(/^chr:(\d+)$/, moreByTag('tag_string_character', 'персонаж'));

    // Похожие (IQDB)
    bot.action(/^sim:(\d+)$/, async (ctx) => {
        const postId = Number(ctx.match[1]);
        const chatId = ctx.chat.id;

        const started = runner.startTask(ctx, async () => {
            const matches = (await client.similarToPost(postId, 15))
                .filter(m => m.postId !== postId && m.score >= 50);

            const missing = matches.filter(m => !m.post).map(m => m.postId);
            if (missing.length) {
                const posts = await client.postsByIds(missing);
                const byId = new Map(posts.map(p => [p.id, p]));
                for (const m of matches) m.post ??= byId.get(m.postId);
            }

            const skip = await runner.skipFor(chatId);
            const posts = matches.map(m => m.post).filter(p => p && !skip(p));
            const sent = await runner.sendResults(ctx.telegram, chatId, posts, 3, { header: '🔍 <b>Похожее</b>' });
            if (!sent) {
                await ctx.telegram.sendMessage(chatId, '😔 Похожих картинок не нашлось. Попробуй «🎨 Ещё автора».');
            }
        });

        await ctx.answerCbQuery(started ? '🔍 Ищу похожие…' : BUSY_TEXT);
    });
}
