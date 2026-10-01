import { Markup } from 'telegraf';
import { findPosts } from '../../services/postSearch.js';
import { sendPost } from '../../services/sender.js';
import { buildCaption, escapeHtml, humanizeTag } from '../../utils/format.js';
import { BUSY_TEXT, withTelegramRetry } from '../searchRunner.js';

// Запасные варианты ответов, если в выборке мало разных персонажей
export const FALLBACK_CHARACTERS = [
    'hatsune_miku', 'hakurei_reimu', 'kirisame_marisa', 'artoria_pendragon_(fate)', 'rem_(re:zero)',
    'gawr_gura', 'frieren', 'makima_(chainsaw_man)', 'lumine_(genshin_impact)', 'souryuu_asuka_langley',
    'uzumaki_naruto', 'gojou_satoru', 'furina_(genshin_impact)', 'yor_briar', 'kita_ikuyo'
];

const MAX_CALLBACK_BYTES = 64;
const splitTags = (value) => (value || '').split(' ').filter(Boolean);
const fitsCallback = (postId, tag) => Buffer.byteLength(`qa:${postId}:${tag}`) <= MAX_CALLBACK_BYTES;

export function shuffle(items, random = Math.random) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/**
 * Составляет вопрос: пост с одним персонажем + 3 неправильных варианта.
 * @returns {{ post, answer: string, options: string[] } | null}
 */
export function buildQuestion(posts, random = Math.random) {
    const candidates = posts.filter(p => splitTags(p.tag_string_character).length === 1);
    const post = candidates.find(p => fitsCallback(p.id, splitTags(p.tag_string_character)[0]));
    if (!post) return null;

    const answer = splitTags(post.tag_string_character)[0];
    const others = [...new Set(candidates.map(p => splitTags(p.tag_string_character)[0]))];
    const pool = [...shuffle(others, random), ...shuffle(FALLBACK_CHARACTERS, random)]
        .filter(tag => tag !== answer && fitsCallback(post.id, tag));
    const wrong = [...new Set(pool)].slice(0, 3);
    return { post, answer, options: shuffle([answer, ...wrong], random) };
}

/**
 * /quiz — «Угадай персонажа», /quiztop — таблица лидеров.
 */
export function registerQuiz(bot, { client, config, userData, runner }) {
    const userAgent = config.danbooru.userAgent;

    async function ask(ctx) {
        const chatId = ctx.chat.id;
        const posts = await findPosts(client, {
            tags: [{ name: 'chartags:1', meta: true, postCount: 0 }, { name: 'score:>50', meta: true, postCount: 0 }],
            rating: 'general',
            count: 20,
            tagLimit: config.danbooru.tagLimit,
            limit: 60
        });
        const question = buildQuestion(posts);
        if (!question) {
            await ctx.telegram.sendMessage(chatId, '😔 Не получилось придумать вопрос, попробуй ещё раз: /quiz');
            return;
        }
        const { post, options } = question;
        const keyboard = Markup.inlineKeyboard(options.map(tag => [Markup.button.callback(humanizeTag(tag), `qa:${post.id}:${tag}`)]));
        const sent = await withTelegramRetry(() => sendPost(ctx.telegram, chatId, post, {
            client, userAgent, caption: '🎮 <b>Угадай персонажа!</b>', extra: keyboard
        }));
        if (!sent) await ctx.telegram.sendMessage(chatId, '😔 Картинка не загрузилась, попробуй ещё раз: /quiz');
    }

    const start = (ctx) => runner.startTask(ctx, () => ask(ctx));

    bot.command('quiz', async (ctx) => {
        if (!start(ctx)) await ctx.reply(BUSY_TEXT);
    });

    bot.action('quiz', async (ctx) => {
        await ctx.answerCbQuery(start(ctx) ? '🎮 Новый вопрос…' : BUSY_TEXT);
    });

    bot.action(/^qa:(\d+):(.+)$/, async (ctx) => {
        const postId = Number(ctx.match[1]);
        const choice = ctx.match[2];
        let post;
        try {
            post = await client.post(postId);
        } catch (error) {
            return ctx.answerCbQuery(`⚠️ ${error.message}`);
        }
        const answer = splitTags(post.tag_string_character)[0];
        const correct = choice === answer;
        const score = await userData.quiz.record(ctx.from, correct);

        await ctx.answerCbQuery(correct ? `✅ Верно! Серия: ${score.streak}` : `❌ Это ${humanizeTag(answer)}`);

        const name = escapeHtml(ctx.from.first_name || ctx.from.username || 'Игрок');
        const verdict = correct
            ? `✅ <b>${name}</b>: верно! Серия: ${score.streak} 🔥`
            : `❌ <b>${name}</b>: мимо — это <b>${escapeHtml(humanizeTag(answer))}</b>`;
        await ctx.editMessageCaption(buildCaption(post, { postUrl: client.postUrl(post.id), header: verdict, maxGeneralTags: 8 }), {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[
                Markup.button.callback('▶️ Ещё вопрос', 'quiz'),
                Markup.button.callback('🏆 Рейтинг', 'quiztop')
            ]])
        }).catch(() => {});
    });

    const showTop = async (ctx) => {
        const top = await userData.quiz.leaderboard(10);
        const text = top.length
            ? ['🏆 <b>Лучшие знатоки</b>', '', ...top.map((p, i) =>
                `${['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} ${escapeHtml(p.name)} — ${p.correct}/${p.total} (лучшая серия ${p.best})`)].join('\n')
            : '🏆 Пока никто не играл. Начни: /quiz';
        await ctx.reply(text, { parse_mode: 'HTML' });
    };

    bot.command('quiztop', showTop);
    bot.action('quiztop', async (ctx) => {
        await ctx.answerCbQuery();
        await showTop(ctx);
    });
}
