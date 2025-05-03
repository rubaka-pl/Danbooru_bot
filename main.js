import { Telegraf, Markup, session } from 'telegraf';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
//api
const config = {
    token: '7897604514:AAGxxj4kFa4vltdztAh1rPLQBB1ygKEJqrQ',
    groupId: '@Obitel_Dionisa',
    storageFile: path.resolve('./sent_images.json'),
    api: {
        baseUrl: 'https://danbooru.donmai.us',
        baseTags: [
            'rating:general',
            'status:active',
            'date:2017-01-01..',
        ],
        limit: 100,
        timeout: 15000
    }
};

const bot = new Telegraf(config.token);
let sentImageHashes = new Set();

// Инициализация сессии
bot.use(session());
bot.use(async (ctx, next) => {
    ctx.session ??= { notified: false, userQuery: '' };
    return next();
});

// Загрузка истории
(async () => {
    try {
        const data = await fs.readFile(config.storageFile, 'utf8');
        sentImageHashes = new Set(JSON.parse(data));
    } catch {
        console.log('Новая история создана');
    }
})();

// Утилиты
const utils = {
    saveHistory: async () => {
        await fs.writeFile(config.storageFile, JSON.stringify([...sentImageHashes]));
    },

    checkImage: async (url) => {
        try {
            const res = await fetch(url, { method: 'HEAD' });
            return res.ok && res.headers.get('content-type')?.startsWith('image/');
        } catch {
            return false;
        }
    },

    formatTags: (post) => {
        const processTag = (tagString) => {
            const rawTag = tagString?.split(' ')[0] || '';
            const name = rawTag
                .replace(/_/g, ' ')
                .split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
            return { tag: rawTag, name: name || 'неизвестен' };
        };

        return {
            author: processTag(post.tag_string_artist),
            character: processTag(post.tag_string_character),
            copyright: processTag(post.tag_string_copyright),
            general: post.tag_string_general?.split(' ') || [],
            date: post.created_at?.split('T')[0] || 'нет даты'
        };
    },

    // функция для форматирования списка персонажей
    formatCharactersList: (characters) => {
        return characters.map(char => {
            const formatted = char
                .replace(/_/g, ' ')
                .replace(/(^|\s)\S/g, a => a.toUpperCase());
            return `${formatted} #${char}`;
        }).join('\n');
    }
};

// Приветственное сообщение
bot.use(async (ctx, next) => {
    if (ctx.chat?.type === 'private' && !ctx.session.notified) {
        await ctx.reply(
            '🎨 Привет! Напиши мне:\n' +
            '• Название аниме или персонажа (например "naruto")\n' +
            '• Или список персонажей через Enter:\n' +
            'character1\ncharacter2\ncharacter3\n\n' +
            'Я найду тебе актуальные изображения!'
        );
        ctx.session.notified = true;
    }
    return next();
});

// Обработчик текстовых сообщений
bot.on('text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;

    // Проверяем, если сообщение содержит несколько строк (персонажей)
    if (ctx.message.text.includes('\n')) {
        const characters = ctx.message.text
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => line.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '_'));

        if (characters.length === 0) return;

        ctx.session.userQuery = characters.join('\n');

        await ctx.reply(
            `Найдено ${characters.length} персонажей:\n\n${utils.formatCharactersList(characters)}\n\nСколько изображений показать для каждого?`,
            Markup.inlineKeyboard(
                [
                    Markup.button.callback('1', 'multi_1'),
                    Markup.button.callback('2', 'multi_2'),
                    Markup.button.callback('3', 'multi_3'),
                ]
            )
        );
    } else {
        const query = ctx.message.text
            .trim()
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, '_');

        ctx.session.userQuery = query;

        await ctx.reply('Сколько изображений показать?', Markup.inlineKeyboard([
            [Markup.button.callback('1', '1'),
            Markup.button.callback('3', '3'),
            Markup.button.callback('5', '5')]
        ]));
    }
});

// Обработка выбора количества (для одиночных запросов)
bot.action(['1', '3', '5'], async (ctx) => {
    await handleSearch(ctx, parseInt(ctx.match[0]));
});

// Обработка выбора количества (для нескольких персонажей)
bot.action(['multi_1', 'multi_2', 'multi_3'], async (ctx) => {
    const count = parseInt(ctx.match[0].split('_')[1]);
    const characters = ctx.session.userQuery.split('\n');

    await ctx.answerCbQuery();
    const progressMsg = await ctx.reply(`🔍 Начинаю поиск для ${characters.length} персонажей...`);

    for (const character of characters) {
        await handleSearch(ctx, count, character);
    }

    await ctx.telegram.deleteMessage(progressMsg.chat.id, progressMsg.message_id);
    await ctx.reply('✅ Поиск завершен для всех персонажей');
});

// Общая функция обработки поиска
async function handleSearch(ctx, count, specificQuery = null) {
    try {
        const query = specificQuery || ctx.session.userQuery;
        const progressText = specificQuery
            ? `🔍 Ищу ${count} изображений для "${query.replace(/_/g, ' ')}"...`
            : `🔍 Ищу ${count} изображений...`;

        const progressMessage = await ctx.reply(progressText);

        const searchParams = new URLSearchParams({
            tags: [
                query,
                ...config.api.baseTags,
                Math.random() < 0.7 ? 'order:random' : 'order:rank'
            ].join(' '),
            limit: count + 5
        });

        const response = await fetch(`${config.api.baseUrl}/posts.json?${searchParams}`);
        const posts = await response.json();

        let sentCount = 0;
        for (const post of posts) {
            if (sentCount >= count) break;

            try {
                if (!post.file_url || sentImageHashes.has(post.md5)) continue;

                const valid = await utils.checkImage(post.file_url);
                if (!valid) continue;

                const tags = utils.formatTags(post);
                await ctx.replyWithPhoto(post.file_url, {
                    caption: [
                        `🎨 Персонаж: ${query.replace(/_/g, ' ')}`,
                        tags.author.name !== 'неизвестен' &&
                        `👨🎨 Автор: ${tags.author.name} #${tags.author.tag}`,
                        tags.copyright.tag &&
                        `📺 Аниме: ${tags.copyright.name} #${tags.copyright.tag}`,
                        `📅 Дата: ${tags.date}`,
                        `🏷️ Теги: ${tags.general.map(t => `#${t}`).join(' ')}`
                    ].filter(Boolean).join('\n')
                });

                sentImageHashes.add(post.md5);
                sentCount++;

                await ctx.telegram.editMessageText(
                    progressMessage.chat.id,
                    progressMessage.message_id,
                    null,
                    `${progressText}\n📤 Отправлено: ${sentCount}/${count}`
                );

                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.error(`Ошибка отправки: ${error.message}`);
            }
        }

        await utils.saveHistory();
        await ctx.telegram.deleteMessage(progressMessage.chat.id, progressMessage.message_id);

    } catch (error) {
        console.error('Ошибка обработки:', error);
        ctx.reply(`⚠️ Ошибка при поиске "${query}": ${error.message}`);
    }
}

// Автопостинг в группу
setInterval(async () => {
    try {
        const searchParams = new URLSearchParams({
            tags: [
                ...config.api.baseTags,
                Math.random() < 0.7 ? 'order:random' : 'order:rank',
                'score:>50'
            ].join(' '),
            limit: 10
        });

        const response = await fetch(`${config.api.baseUrl}/posts.json?${searchParams}`);
        const posts = await response.json();

        for (const post of posts) {
            try {
                if (!post.file_url || sentImageHashes.has(post.md5)) continue;

                const valid = await utils.checkImage(post.file_url);
                if (!valid) continue;

                const tags = utils.formatTags(post);
                await bot.telegram.sendPhoto(config.groupId, post.file_url, {
                    caption: [
                        tags.author.tag !== 'неизвестен' &&
                        `🎨 Автор: ${tags.author.name} #${tags.author.tag}`,
                        tags.character.tag &&
                        `👤 Персонаж: ${tags.character.name} #${tags.character.tag}`,
                        tags.copyright.tag &&
                        `📺 Аниме: ${tags.copyright.name} #${tags.copyright.tag}`,
                        `📅 Дата: ${tags.date}`,
                        `⭐ Рейтинг: ${post.score}`,
                        `🏷️ Теги: ${(tags.general || []).slice(0, 8).map(t => `#${t}`).join(' ')}`
                    ].filter(Boolean).join('\n')
                });

                sentImageHashes.add(post.md5);
                await utils.saveHistory();
                break;

            } catch (error) {
                console.error('Ошибка автопостинга:', error);
            }
        }
    } catch (error) {
        console.error('API Error:', error);
    }
}, 5000); // 5 секунд

// Запуск бота
bot.launch().then(() => {
    console.log('🟢 Бот запущен!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));