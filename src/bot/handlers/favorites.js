import { Markup } from 'telegraf';
import { sendAlbum, sendPost } from '../../services/sender.js';
import { escapeHtml, humanizeTag } from '../../utils/format.js';
import { BUSY_TEXT, withTelegramRetry } from '../searchRunner.js';

const PAGE_SIZE = 10;

const firstTag = (value) => (value || '').split(' ').filter(Boolean)[0];

function describePost(post, index) {
    const character = firstTag(post.tag_string_character);
    const artist = firstTag(post.tag_string_artist);
    const title = [character && humanizeTag(character), artist && `🎨 ${humanizeTag(artist)}`].filter(Boolean).join(' · ');
    return `${index + 1}. ${escapeHtml(title || `Пост ${post.id}`)}`;
}

/**
 * /favs — избранное постранично (альбомами по 10).
 */
export function registerFavorites(bot, { client, config, userData, runner }) {
    const userAgent = config.danbooru.userAgent;

    async function showPage(ctx, page) {
        const chatId = ctx.chat.id;
        const ids = await userData.favorites.list(chatId);
        if (!ids.length) {
            return ctx.telegram.sendMessage(chatId, '💔 Избранное пустое. Жми ❤️ под картинками, чтобы сохранять.');
        }

        const pages = Math.ceil(ids.length / PAGE_SIZE);
        const current = Math.min(Math.max(page, 0), pages - 1);
        const slice = ids.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

        const byId = new Map((await client.postsByIds(slice)).map(p => [p.id, p]));
        const posts = slice.map(id => byId.get(id)).filter(Boolean);

        const album = await withTelegramRetry(() => sendAlbum(ctx.telegram, chatId, posts, { client, userAgent }));
        const inAlbum = new Set(album.map(a => a.post.id));
        for (const post of posts.filter(p => !inAlbum.has(p.id))) {
            await withTelegramRetry(() => sendPost(ctx.telegram, chatId, post, { client, userAgent }));
        }

        const deleteButtons = posts.map((post, i) => Markup.button.callback(`❌${i + 1}`, `fd:${post.id}`));
        const nav = [
            current > 0 && Markup.button.callback('◀️', `fp:${current - 1}`),
            current < pages - 1 && Markup.button.callback('▶️', `fp:${current + 1}`)
        ].filter(Boolean);

        await ctx.telegram.sendMessage(chatId, [
            `❤️ <b>Избранное</b> — стр. ${current + 1}/${pages} (всего ${ids.length})`,
            ...posts.map(describePost),
            '',
            'Нажми ❌N, чтобы убрать из избранного.'
        ].join('\n'), {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([deleteButtons.slice(0, 5), deleteButtons.slice(5), nav].filter(r => r.length))
        });
    }

    bot.command('favs', async (ctx) => {
        const page = Math.max(Number.parseInt(ctx.payload, 10) || 1, 1) - 1;
        if (!runner.startTask(ctx, () => showPage(ctx, page))) return ctx.reply(BUSY_TEXT);
    });

    bot.action(/^fp:(\d+)$/, async (ctx) => {
        const started = runner.startTask(ctx, () => showPage(ctx, Number(ctx.match[1])));
        await ctx.answerCbQuery(started ? undefined : BUSY_TEXT);
    });

    bot.action(/^fd:(\d+)$/, async (ctx) => {
        const postId = Number(ctx.match[1]);
        await userData.favorites.remove(ctx.chat.id, postId);
        await ctx.answerCbQuery('💔 Убрано из избранного');

        const keyboard = ctx.callbackQuery.message?.reply_markup?.inline_keyboard ?? [];
        const next = keyboard
            .map(row => row.filter(button => button.callback_data !== `fd:${postId}`))
            .filter(row => row.length);
        await ctx.editMessageReplyMarkup({ inline_keyboard: next }).catch(() => {});
    });
}
