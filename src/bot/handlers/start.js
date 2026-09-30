import { Markup } from 'telegraf';
import { NSFW_TAGS } from '../../utils/ratings.js';

const HELP = [
    '🎨 <b>Привет! Я ищу арты на Danbooru.</b>',
    '',
    '<b>Как писать запрос:</b>',
    '• Персонаж или тайтл: <code>hatsune miku</code>, <code>naruto</code>, <code>genshin impact</code>',
    '• Можно по-русски: <code>мику</code>, <code>наруто</code>',
    '• Несколько тегов — через запятую: <code>rem, maid, smile</code>',
    '• Исключить тег — минус: <code>miku, -male_focus</code>',
    '• Каждая строка — отдельный поиск (список персонажей через Enter)',
    '• Рейтинг прямо в запросе: <code>rem nsfw</code>, <code>miku safe</code>',
    '• Метатеги Danbooru: <code>score:>100</code>, <code>order:score</code>',
    '• Можно просто вставить хэштеги из подписи: <code>#hatsune_miku #vocaloid</code>',
    '',
    'Порядок слов неважен: <code>naruto uzumaki</code> = <code>uzumaki_naruto</code>.',
    'После запроса выбери рейтинг и сколько картинок прислать.',
    '',
    '<b>Команды:</b>',
    '/random — случайная картинка (<code>/random nsfw</code>)',
    '/top — популярное за день (<code>/top week</code>, <code>/top month nsfw</code>)',
    '/tags — список 18+ тегов',
    '/help — эта справка'
].join('\n');

export function registerStartHandlers(bot) {
    const sendHelp = (ctx) => ctx.reply(HELP, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('📚 18+ теги', 'show_tags')]])
    });

    bot.start(sendHelp);
    bot.help(sendHelp);

    const sendTags = (ctx) => ctx.reply(
        `📚 <b>18+ теги</b> (при них рейтинг сам переключится на 🔴 18+):\n\n${NSFW_TAGS.map(t => `<code>${t}</code>`).join(', ')}`,
        { parse_mode: 'HTML' }
    );

    bot.command('tags', sendTags);
    bot.action('show_tags', async (ctx) => {
        await ctx.answerCbQuery();
        await sendTags(ctx);
    });
}

export const COMMANDS = [
    { command: 'start', description: 'Начать' },
    { command: 'help', description: 'Как искать' },
    { command: 'random', description: 'Случайная картинка' },
    { command: 'top', description: 'Популярное за день' },
    { command: 'tags', description: 'Список 18+ тегов' }
];
