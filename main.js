import { Telegraf, Markup } from 'telegraf';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { session } from 'telegraf';

const config = {
    token: 'YOURE_TOKEN_HERE',
    groupId: '@GROUP_NAME',
    storageFile: path.resolve('./sent_images.json'),
    api: {
        baseUrl: 'https://danbooru.donmai.us',
        baseTags: [
            'status:active',
            'date:2017-01-01..'
        ],
        limit: 100,
        timeout: 15000
    }
};

const nsfwTags = [
    'nsfw', 'hentai', 'ecchi', 'lewd', 'explicit', 'adult', '18+', 'dick', 'cock', 'penis', 'vagina', 'pussy', 'cunt', 'clit', 'balls', 'testicles', 'tits', 'boobs', 'breasts', 'nipples', 'ass', 'butt', 'booty', 'anus', 'anal', 'nude', 'naked', 'bareback', 'no_panties', 'no_bra', 'sex', 'fuck', 'intercourse', 'blowjob', 'bj', 'handjob', 'hj', 'titfuck', 'paizuri', 'cum', 'creampie', 'facial', 'bukkake', 'threesome', 'orgy', 'gangbang', 'masturbation', 'fingering', 'cunnilingus', 'fellatio', 'rimjob', 'bdsm', 'bondage', 'gag', 'collar', 'leash', 'spanking', 'whip', 'chains', 'latex', 'asslicking', 'leather', 'uniform', 'lingerie', 'stockings', 'pantyhose', 'footjob', 'feet', 'toes', 'armpit', 'urethral', 'futanari', 'trap', 'yaoi', 'yuri', 'futa', 'shemale', 'trans', 'transgender', 'crossdressing', 'femboy', 'tomboy', 'otokonoko', 'pee', 'piss', 'watersports', 'scat', 'vore', 'guro', 'rape', 'ahegao', 'deepthroat', 'doggystyle', 'missionary', 'cowgirl', 'reverse_cowgirl', 'double_penetration', 'group', 'public', 'exhibitionism', 'voyeur', 'dildo', 'chastity_cage', 'butt_plug', 'licking_dildo', 'rape', 'lolicon', 'nipples', 'guro', 'futanari', 'futa_with_female', 'cum', 'anilingus', 'fellatio', 'group_sex', 'sex', 'orgy', 'ffm_threesome', 'mmf_threesome', 'gangbang', 'cooperative_fellatio', 'oral', 'oral_sandwich', 'standing_anilingus', 'netorare', 'threesome', 'anal_object_insertion', 'cum_in_ass', 'ejaculating_while_penetrated', 'wiffle_gag', 'small_penis', 'nub_chastity_cage', 'anal_fluid', 'futanari_masturbation', 'erection', 'male_penetrated', 'huge_penis', 'ejaculation', 'penis_size_difference', 'veiny_penis',
];

const bot = new Telegraf(config.token);
let sentImageHashes = new Set();

bot.use(session());
bot.use(async (ctx, next) => {
    ctx.session ??= { notified: false, userQuery: '' };
    return next();
});

(async () => {
    try {
        const data = await fs.readFile(config.storageFile, 'utf8');
        sentImageHashes = new Set(JSON.parse(data));
    } catch {
        console.log('Новая история создана ');
    }
})();

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

    formatCharactersList: (characters) => {
        return characters.map(char => {
            const formatted = char
                .replace(/_/g, ' ')
                .replace(/(^|\s)\S/g, a => a.toUpperCase());
            return `${formatted} #${char}`;
        }).join('\n');
    }
};
bot.start(async (ctx) => {
    if (ctx.chat?.type === 'private') {
        await ctx.reply(
            '🎨 Привет! Напиши мне:\n' +
            '• Название аниме или персонажа (например "naruto")\n' +
            '• Или список персонажей через Enter\n' +
            'Я найду тебе актуальные изображения!\n\n' +
            '🧠 Или нажми на кнопку ниже, чтобы увидеть список NSFW-тегов',
            Markup.inlineKeyboard([
                [Markup.button.callback('📚 Показать теги', 'show_tags')]
            ])
        );
        ctx.session.notified = true;
    }
});

bot.action('show_tags', async (ctx) => {
    await ctx.answerCbQuery();

    // Ограничение на длину сообщения в Telegram — максимум ~4096 символов.
    const tagChunks = [];
    let current = '';

    for (const tag of nsfwTags) {
        const tagString = `#${tag}, `;
        if ((current + tagString).length > 3500) {
            tagChunks.push(current);
            current = '';
        }
        current += tagString;
    }
    if (current) tagChunks.push(current);

    for (const chunk of tagChunks) {
        await ctx.reply(`📚 Доступные NSFW-теги:\n\n${chunk}`);
    }
});


bot.on('text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;

    const inputText = ctx.message.text.trim();
    if (inputText === '/start') return;

    if (inputText.includes('\n')) {
        const characters = inputText
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => line.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '_'));

        if (characters.length === 0) return;
        ctx.session.userQuery = characters.join('\n');

        await ctx.reply(
            `Найдено ${characters.length} персонажей:\n\n${utils.formatCharactersList(characters)}\n\nСколько изображений показать для каждого?`,
            Markup.inlineKeyboard([
                [
                    Markup.button.callback('1', 'multi_1'),
                    Markup.button.callback('2', 'multi_2'),
                    Markup.button.callback('3', 'multi_3')
                ]
            ])
        );
    } else {
        const query = inputText
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, '_');

        ctx.session.userQuery = query;

        await ctx.reply('Сколько изображений показать?', Markup.inlineKeyboard([
            [
                Markup.button.callback('1', '1'),
                Markup.button.callback('3', '3'),
                Markup.button.callback('5', '5')
            ]
        ]));
    }
});

bot.action(['1', '3', '5'], async (ctx) => {
    await handleSearch(ctx, parseInt(ctx.match[0]));
});

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

async function handleSearch(ctx, count, specificQuery = null) {
    try {
        const query = specificQuery || ctx.session.userQuery;
        const progressText = specificQuery
            ? `🔍 Ищу ${count} изображений для "${query.replace(/_/g, ' ')}"...`
            : `🔍 Ищу ${count} изображений...`;

        const progressMessage = await ctx.reply(progressText);

        const rating = nsfwTags.some(tag => query.includes(tag)) ? 'rating:explicit' : 'rating:general';

        const searchParams = new URLSearchParams({
            tags: [
                query,
                ...config.api.baseTags.filter(tag => !tag.startsWith('rating:')),
                rating,
                Math.random() < 0.7 ? 'order:random' : 'order:rank'
            ].join(' '),
            limit: count + 5
        });

        const response = await fetch(`${config.api.baseUrl}/posts.json?${searchParams}`);
        const posts = await response.json();

        let sentCount = 0;
        for (const post of posts) {
            if (sentCount >= count) break;
            if (!post.file_url || sentImageHashes.has(post.md5)) continue;

            const valid = await utils.checkImage(post.file_url);
            if (!valid) continue;

            const tags = utils.formatTags(post);
            await ctx.replyWithPhoto(post.file_url, {
                caption: [
                    `🎨 Персонаж: ${query.replace(/_/g, ' ')}`,
                    tags.author.name !== 'неизвестен' && `👨🎨 Автор: ${tags.author.name} #${tags.author.tag}`,
                    tags.copyright.tag && `📺 Аниме: ${tags.copyright.name} #${tags.copyright.tag}`,
                    `📅 Дата: ${tags.date}`,
                    `🏷️ Теги: ${tags.general.map(t => `#${t}`).join(' ')}`
                ].filter(Boolean).join('\n')
            });

            sentImageHashes.add(post.md5);
            sentCount++;
            await ctx.telegram.editMessageText(progressMessage.chat.id, progressMessage.message_id, null,
                `${progressText}\n📤 Отправлено: ${sentCount}/${count}`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        await utils.saveHistory();
        await ctx.telegram.deleteMessage(progressMessage.chat.id, progressMessage.message_id);

    } catch (error) {
        console.error('Ошибка обработки:', error);
        ctx.reply(`⚠️ Ошибка при поиске "${ctx.session.userQuery}": ${error.message}`);
    }
}

// ⏱️ АВТОПОСТ В КАНАЛ РАЗ В 5 СЕКУНД ТОЛЬКО GENERAL
let autoPostDelay = 5000;

async function autoPost() {
    console.log('📡 Запуск автопоста...');

    try {
        const tagQuery = [...config.api.baseTags, 'score:>50', 'rating:general', 'order:random'].join(' ');
        console.log('🔍 Поиск с тегами:', tagQuery);

        const searchParams = new URLSearchParams({
            tags: tagQuery,
            limit: 10
        });

        const url = `${config.api.baseUrl}/posts.json?${searchParams}`;
        console.log('📥 Запрос к:', url);

        const response = await fetch(url);
        console.log('📊 Статус ответа API:', response.status);

        if (response.status === 429) {
            console.warn('⚠️ Слишком много запросов! Увеличиваем интервал до 10 секунд.');
            autoPostDelay = 10000;
            return;
        }
        if (!response.ok) throw new Error(`API ответ ${response.status}`);

        const posts = await response.json();
        if (!Array.isArray(posts)) {
            console.error('❌ Некорректный JSON от API:', posts);
            throw new Error('API вернул некорректный формат');
        }

        console.log(`✅ Получено ${posts.length} постов от API`);

        for (const post of posts) {
            const imageUrl = post.large_file_url || post.preview_file_url || post.file_url;
            if (!imageUrl) {
                console.log('⛔ Пропущен: отсутствует подходящий URL');
                continue;
            }

            const fullUrl = imageUrl.startsWith('http') ? imageUrl : config.api.baseUrl + imageUrl;

            if (sentImageHashes.has(post.md5)) {
                console.log('⛔ Пропущен: уже отправляли этот md5', post.md5);
                continue;
            }

            const valid = await utils.checkImage(fullUrl);
            if (!valid) {
                console.log('⛔ Пропущен: не прошёл проверку HEAD', fullUrl);
                continue;
            }

            const tags = utils.formatTags(post);
            console.log('📤 Отправка изображения:', fullUrl);

            await bot.telegram.sendPhoto(config.groupId, fullUrl, {
                caption: [
                    `🌟`,
                    tags.author.name !== 'неизвестен' && `🎨 Автор: ${tags.author.name} #${tags.author.tag}`,
                    tags.character.name && `👤 Персонаж: ${tags.character.name} #${tags.character.tag}`,
                    tags.copyright.name && `📺 Аниме: ${tags.copyright.name} #${tags.copyright.tag}`,
                    `📅 Дата: ${tags.date}`,
                    `🏷️ Теги: ${(tags.general || []).slice(0, 8).map(t => `#${t}`).join(' ')}`
                ].filter(Boolean).join('\n')
            });

            console.log('✅ Изображение успешно отправлено!');
            sentImageHashes.add(post.md5);
            await utils.saveHistory();

            autoPostDelay = 5000; // сброс обратно
            break;
        }
    } catch (error) {
        console.error('❌ Ошибка автопостинга:', error.message);
    } finally {
        console.log(`⏳ Следующий автопост через ${autoPostDelay / 1000} сек...\n`);
        setTimeout(autoPost, autoPostDelay);
    }
}

// Запуск автопостинга
autoPost();

bot.launch().then(() => console.log('🟢 Бот запущен!'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
