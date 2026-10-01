import { Markup } from 'telegraf';
import { findPosts } from '../../services/postSearch.js';
import { sendOriginal } from '../../services/sender.js';
import { subTagsToQuery } from '../../services/subscriptions.js';
import { parseUserInput } from '../../utils/query.js';
import { enforceSafe, ratingLabel } from '../../utils/ratings.js';
import { escapeHtml, humanizeTag } from '../../utils/format.js';
import { favoriteTags } from './forYou.js';
import { BUSY_TEXT } from '../searchRunner.js';

const onOff = (v) => (v ? 'вкл' : 'выкл');

// Метатеги Danbooru не считаются в лимит тегов — фильтр по размеру бесплатный
export const WALLPAPER_FILTERS = {
    desktop: { label: '🖥 Обои для компьютера', tags: ['ratio:>=1.6', 'width:>=1920'] },
    phone: { label: '📱 Обои для телефона', tags: ['ratio:<=0.65', 'height:>=1600'] }
};

const PHONE_WORDS = new Set(['phone', 'mobile', 'телефон', 'телефона', 'смартфон', 'вертикальные']);
const DESKTOP_WORDS = new Set(['desktop', 'pc', 'пк', 'компьютер', 'компа', 'горизонтальные']);

/** "/wallpaper phone miku" → { device: 'phone', query: 'miku' } */
export function parseWallpaperArgs(payload = '') {
    const words = payload.trim().split(/\s+/).filter(Boolean);
    let device = 'desktop';
    const rest = words.filter(word => {
        const lower = word.toLowerCase();
        if (PHONE_WORDS.has(lower)) { device = 'phone'; return false; }
        if (DESKTOP_WORDS.has(lower)) { device = 'desktop'; return false; }
        return true;
    });
    return { device, query: rest.join(' ') };
}

/**
 * /me — профиль, /history — последние запросы, /wallpaper — обои в оригинальном качестве.
 */
export function registerProfile(bot, { client, resolver, config, userData, runner }) {
    // ---------- /me ----------
    bot.command('me', async (ctx) => {
        const chatId = ctx.chat.id;
        const [favs, subs, blocked, settings, quiz] = await Promise.all([
            userData.favorites.list(chatId),
            userData.subscriptions.list(chatId),
            userData.blocklist.list(chatId),
            userData.settings.get(chatId),
            userData.quiz.get(ctx.from.id)
        ]);
        let taste = [];
        if (favs.length) {
            taste = favoriteTags(await client.postsByIds(favs.slice(0, 40)).catch(() => [])).slice(0, 5);
        }
        const name = escapeHtml(ctx.from.first_name || ctx.from.username || 'Ты');
        await ctx.reply([
            `👤 <b>${name}</b>`,
            '',
            `❤️ Избранное: ${favs.length} · 🔔 Подписок: ${subs.length} · 🚫 Скрытых тегов: ${blocked.length}`,
            `🎮 Викторина: ${quiz ? `${quiz.correct}/${quiz.total}, лучшая серия ${quiz.best}` : 'ещё не играл(а) — /quiz'}`,
            `⚙️ ${ratingLabel(settings.rating)} · ${settings.count} шт. · быстрый ${onOff(settings.quick)} · безопасный ${onOff(settings.safe)}`,
            taste.length && `💘 Твой вкус: ${taste.map(t => escapeHtml(humanizeTag(t.tag))).join(', ')}`,
            '',
            'Подборка по вкусу — /foryou · настройки — /settings'
        ].filter(line => line !== false).join('\n'), { parse_mode: 'HTML' });
    });

    // ---------- /history ----------
    async function showHistory(ctx, edit = false) {
        const items = await userData.history.list(ctx.chat.id);
        const text = items.length
            ? ['🕘 <b>Последние запросы</b> — нажми, чтобы повторить:', ...items.map((tags, i) => `${i + 1}. <code>${escapeHtml(tags.join(' + '))}</code>`)].join('\n')
            : '🕘 История пуста — поищи что-нибудь!';
        const buttons = items.map((tags, i) => Markup.button.callback(`🔁 ${i + 1}`, `h:${i}`));
        const rows = [buttons.slice(0, 5), buttons.slice(5)];
        if (items.length) rows.push([Markup.button.callback('🗑 Очистить', 'h:clear')]);
        const extra = { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows.filter(r => r.length)) };
        return edit ? ctx.editMessageText(text, extra).catch(() => {}) : ctx.reply(text, extra);
    }

    bot.command('history', (ctx) => showHistory(ctx));

    bot.action('h:clear', async (ctx) => {
        await userData.history.clear(ctx.chat.id);
        await ctx.answerCbQuery('🗑 История очищена');
        await showHistory(ctx, true);
    });

    bot.action(/^h:(\d+)$/, async (ctx) => {
        const tags = (await userData.history.list(ctx.chat.id))[Number(ctx.match[1])];
        if (!tags) return ctx.answerCbQuery('Запрос не найден');
        if (!runner.startDefaultSearch(ctx, [subTagsToQuery(tags)])) return ctx.answerCbQuery(BUSY_TEXT);
        await ctx.answerCbQuery(`🔁 ${tags.join(' + ')}`);
    });

    // ---------- /wallpaper ----------
    bot.command(['wallpaper', 'wall'], async (ctx) => {
        const chatId = ctx.chat.id;
        const { device, query } = parseWallpaperArgs(ctx.payload);
        const filter = WALLPAPER_FILTERS[device];

        const started = runner.startTask(ctx, async () => {
            let tags = [];
            if (query) {
                const parsed = parseUserInput(query.replace(/\n/g, ', '), { maxGroups: 1 });
                const group = parsed.groups[0] ? await resolver.resolveGroup(parsed.groups[0]) : { tags: [], unresolved: [] };
                if (!group.tags.length) {
                    await ctx.telegram.sendMessage(chatId, `❌ Не нашёл: ${escapeHtml(query)}`);
                    return;
                }
                tags = group.tags;
            }
            const settings = await userData.settings.get(chatId);
            const rating = enforceSafe(settings.rating, settings.safe).rating;
            const skip = await runner.skipFor(chatId);
            const posts = await findPosts(client, {
                tags: [...tags, ...filter.tags.map(name => ({ name, meta: true, postCount: 0 })), { name: 'score:>10', meta: true, postCount: 0 }],
                rating,
                count: 3,
                tagLimit: config.danbooru.tagLimit,
                skip
            });
            let sent = 0;
            for (const post of posts.filter(p => ['jpg', 'jpeg', 'png', 'webp'].includes(p.file_ext)).slice(0, 3)) {
                const result = await sendOriginal(ctx.telegram, chatId, post, {
                    client, userAgent: config.danbooru.userAgent, header: filter.label
                });
                if (result === 'sent' || result === 'link') sent++;
            }
            if (!sent) {
                await ctx.telegram.sendMessage(chatId, '😔 Не нашёл обоев с такими параметрами. Попробуй другой запрос или рейтинг.');
            }
        });
        if (!started) await ctx.reply(BUSY_TEXT);
    });
}
