import { reverseSearch } from '../../services/reverseSearch.js';
import { escapeHtml } from '../../utils/format.js';
import { BUSY_TEXT } from '../searchRunner.js';

const MAX_FILE = 20 * 1024 * 1024; // Telegram Bot API отдаёт файлы до 20 МБ
// У Danbooru сходство нормализовано: «сырые» 70% превращаются в 50
const GOOD_MATCH = 75;
const POSSIBLE_MATCH = 50;

/**
 * Пользователь присылает картинку → ищем источник на Danbooru (IQDB).
 */
export function registerReverseSearch(bot, { client, config, runner }) {
    const userAgent = config.danbooru.userAgent;

    async function handle(ctx, fileId, filename) {
        const chatId = ctx.chat.id;
        const started = runner.startTask(ctx, async () => {
            const status = await ctx.reply('🔎 Ищу источник картинки…');
            try {
                const link = await ctx.telegram.getFileLink(fileId);
                const res = await fetch(link, { signal: AbortSignal.timeout(30000) });
                if (!res.ok) throw new Error(`не удалось скачать картинку (HTTP ${res.status})`);
                const buffer = Buffer.from(await res.arrayBuffer());

                const matches = await reverseSearch(client, buffer, { filename, userAgent });
                const best = matches[0];

                if (!best || best.score < POSSIBLE_MATCH) {
                    await ctx.reply(
                        '😔 На Danbooru такой картинки не нашёл.\n' +
                        'Попробуй: <a href="https://saucenao.com">SauceNAO</a> · <a href="https://ascii2d.net">ascii2d</a> · <a href="https://yandex.ru/images">Яндекс Картинки</a>',
                        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
                    );
                    return;
                }

                const verdict = best.score >= GOOD_MATCH ? '✅ Нашёл!' : '🤔 Возможно, это оно';
                const source = best.post.source?.startsWith('http')
                    ? `\n📎 <a href="${escapeHtml(best.post.source)}">Оригинал</a>`
                    : '';
                const sent = await runner.sendResults(ctx.telegram, chatId, [best.post], 1, {
                    header: `${verdict} Сходство ${Math.round(best.score)}%${source}`
                });
                if (!sent) {
                    await ctx.reply(`${verdict} ${client.postUrl(best.post.id)} (сходство ${Math.round(best.score)}%)`);
                }

                const others = matches.slice(1).filter(m => m.score >= POSSIBLE_MATCH);
                if (others.length) {
                    await ctx.reply(
                        ['Другие совпадения:', ...others.map(m => `• <a href="${client.postUrl(m.post.id)}">#${m.post.id}</a> — ${Math.round(m.score)}%`)].join('\n'),
                        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
                    );
                }
            } finally {
                await ctx.telegram.deleteMessage(chatId, status.message_id).catch(() => {});
            }
        });
        if (!started) await ctx.reply(BUSY_TEXT);
    }

    bot.on('photo', (ctx, next) => {
        if (ctx.chat.type !== 'private') return next();
        const photo = ctx.message.photo.at(-1); // самое большое разрешение
        return handle(ctx, photo.file_id, 'image.jpg');
    });

    bot.on('document', (ctx, next) => {
        const doc = ctx.message.document;
        if (ctx.chat.type !== 'private' || !doc.mime_type?.startsWith('image/')) return next();
        if (doc.file_size > MAX_FILE) return ctx.reply('⚠️ Файл больше 20 МБ — пришли картинку поменьше.');
        return handle(ctx, doc.file_id, doc.file_name || 'image.jpg');
    });
}
