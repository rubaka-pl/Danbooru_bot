import { Markup } from 'telegraf';
import { findPosts } from '../../services/postSearch.js';
import { parseUserInput } from '../../utils/query.js';
import { DEFAULT_RATING, RATINGS } from '../../utils/ratings.js';
import { buildCaption } from '../../utils/format.js';

const PAGE_SIZE = 30;
const isJpeg = (url) => /\.jpe?g($|\?)/i.test(url || '');
const abs = (url, base) => (!url ? null : url.startsWith('http') ? url : new URL(url, base).toString());

/** Пост → результат inline-запроса (сетка картинок). */
export function toInlineResult(post, client) {
    const base = client.baseUrl;
    const thumb = abs(post.preview_file_url, base);
    if (!thumb) return null;
    const caption = buildCaption(post, { postUrl: client.postUrl(post.id), maxGeneralTags: 8 });
    const reply_markup = Markup.inlineKeyboard([[Markup.button.url('🔗 Danbooru', client.postUrl(post.id))]]).reply_markup;

    if (post.file_ext === 'gif' && post.file_url) {
        return {
            type: 'gif', id: String(post.id), gif_url: abs(post.file_url, base), thumbnail_url: thumb,
            caption, parse_mode: 'HTML', reply_markup
        };
    }
    // Для inline-фото Telegram принимает только JPEG
    const photo = [post.large_file_url, post.file_url].map(u => abs(u, base)).find(isJpeg);
    if (!photo) return null;
    return {
        type: 'photo', id: String(post.id), photo_url: photo, thumbnail_url: thumb,
        photo_width: post.image_width, photo_height: post.image_height,
        caption, parse_mode: 'HTML', reply_markup
    };
}

/**
 * Inline-режим: "@бот miku" в любом чате — сетка картинок.
 * Включается в @BotFather: /setinline.
 */
export function registerInline(bot, { client, resolver, config, userData }) {
    bot.on('inline_query', async (ctx) => {
        const text = ctx.inlineQuery.query.trim();
        const page = Math.max(Number.parseInt(ctx.inlineQuery.offset, 10) || 1, 1);
        const blocked = await userData.blocklist.matcher(ctx.from.id);
        const hasBlocklist = (await userData.blocklist.list(ctx.from.id)).length > 0;

        let posts = [];
        try {
            if (!text) {
                // Пустой запрос — популярное за день (только safe)
                posts = page === 1 ? (await client.popular({ scale: 'day' })).filter(p => p.rating === 'g') : [];
            } else {
                const parsed = parseUserInput(text.replace(/\n/g, ', '), { maxGroups: 1 });
                const group = parsed.groups[0] ? await resolver.resolveGroup(parsed.groups[0]) : { tags: [] };
                if (group.tags.length || parsed.rating) {
                    posts = await findPosts(client, {
                        tags: group.tags,
                        rating: RATINGS[parsed.rating] ? parsed.rating : DEFAULT_RATING,
                        count: PAGE_SIZE,
                        tagLimit: config.danbooru.tagLimit,
                        random: false,
                        page,
                        limit: 60
                    });
                }
            }
        } catch (error) {
            console.error('❌ Inline:', error.message);
        }

        const results = posts
            .filter(p => !blocked(p))
            .map(p => toInlineResult(p, client))
            .filter(Boolean)
            .slice(0, PAGE_SIZE);

        await ctx.answerInlineQuery(results, {
            cache_time: 60,
            is_personal: hasBlocklist,
            next_offset: text && results.length ? String(page + 1) : '',
            button: results.length ? undefined : { text: '🤔 Ничего не нашлось — как искать?', start_parameter: 'help' }
        }).catch(error => console.error('❌ answerInlineQuery:', error.message));
    });
}
