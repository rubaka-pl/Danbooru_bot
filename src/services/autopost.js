import { findPosts } from './postSearch.js';
import { sendAlbum, sendPost } from './sender.js';
import { escapeHtml, humanizeTag, toHashtag } from '../utils/format.js';
import { isQuietTime } from '../utils/quietHours.js';
import { channelKeyboard } from '../bot/request.js';

export const PAUSED_KEY = 'autopost:paused';

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const firstTag = (value) => (value || '').split(' ').filter(Boolean)[0] ?? null;

async function freshPosts(posts, history, limit) {
    const result = [];
    for (const post of posts) {
        if (result.length >= limit) break;
        if (!(await history.has(post.md5))) result.push(post);
    }
    return result;
}

const HOUR = 60 * 60 * 1000;

/**
 * Идёт ли сейчас волна трендов. Цикл «hours трендов → pauseHours обычных»
 * считается от времени, без состояния — одинаково на Render и Vercel.
 */
export function isTrendTime(now, trends) {
    if (!trends?.enabled || !(trends.hours > 0)) return false;
    const cycle = (trends.hours + Math.max(trends.pauseHours, 0)) * HOUR;
    return now.getTime() % cycle < trends.hours * HOUR;
}

/**
 * Пост из трендов: популярное на Danbooru за день, потом за неделю,
 * потом «горячее» (order:rank). Берём случайный из лучших ещё не опубликованных.
 * @returns {Promise<'posted'|null>} null — свежих трендов нет, постим как обычно
 */
async function postTrending({ telegram, client, history, config, channelStats }, rating) {
    const { autopost, danbooru } = config;
    const code = rating === 'sensitive' ? 's' : 'g';
    const sources = [
        () => client.popular({ scale: 'day' }),
        () => client.popular({ scale: 'week' }),
        () => client.posts({ tags: ['order:rank', `rating:${code}`], limit: 100, page: randInt(1, 3) })
    ];
    for (const load of sources) {
        const candidates = (await load().catch(() => []))
            .filter(post => post.rating === code && !post.is_deleted && !post.is_banned);
        const fresh = await freshPosts(candidates, history, 10);
        // Перемешиваем лучшие, чтобы не идти строго по рейтингу
        for (const post of fresh.sort(() => Math.random() - 0.5)) {
            const message = await sendPost(telegram, autopost.channelId, post, {
                client, userAgent: danbooru.userAgent, header: '🔥 <b>В тренде</b>', extra: channelKeyboard(post, client.baseUrl)
            });
            if (!message) continue;
            await remember({ history, channelStats }, message, post);
            console.log(`✅ Автопост: тренд ${post.id} (${rating})`);
            return 'posted';
        }
    }
    return null;
}

async function remember({ history, channelStats }, message, post) {
    await history.add(post.md5);
    await channelStats?.recordPost(message.message_id, post).catch(error => console.warn('⚠️ Статистика:', error.message));
}

/**
 * Один автопост в канал: обычно одна картинка, иногда альбом.
 * Часть постов подбирается по тегам, которые собирают больше всего реакций.
 * Во время волны трендов (см. isTrendTime) — популярное на Danbooru.
 * @param {boolean} [deps.force] — игнорировать паузу и тихие часы (команда /post)
 * @returns {Promise<'posted'|'album'|'battle'|'quiet'|'paused'|'empty'>}
 */
export async function autopostOnce(deps) {
    const { telegram, client, history, config, channelStats, store, now = new Date(), force = false } = deps;
    const { autopost, danbooru } = config;

    if (!force) {
        if (await store?.get(PAUSED_KEY)) return 'paused';
        if (autopost.quietHours && isQuietTime(now, { ...autopost.quietHours, timeZone: autopost.timeZone })) {
            return 'quiet';
        }
    }

    // Примерно каждый N-й пост — sensitive (случайно, чтобы работало и без состояния)
    const rating = Math.random() < 1 / autopost.sensitiveEvery ? 'sensitive' : 'general';
    if (isTrendTime(now, autopost.trends)) {
        const result = await postTrending(deps, rating);
        if (result) return result;
    }

    const defaultTags = autopost.tags.map(name => ({ name, meta: true, postCount: 0 }));
    const themed = (tag) => [{ name: tag, postCount: 0 }, { name: 'score:>20', meta: true, postCount: 0 }];
    const search = (tags, count) => findPosts(client, { tags, rating, count, tagLimit: danbooru.tagLimit });
    const userAgent = danbooru.userAgent;

    const likedTag = Math.random() < autopost.adaptiveShare ? await channelStats?.pickLikedTag() : null;

    const wantBattle = autopost.battleEvery > 0 && Math.random() < 1 / autopost.battleEvery;
    if (wantBattle) {
        const result = await postBattle({ ...deps, search, defaultTags, themed, likedTag });
        if (result) return result;
    }

    const wantAlbum = autopost.albumEvery > 0 && Math.random() < 1 / autopost.albumEvery;

    if (wantAlbum) {
        const [min, max] = autopost.albumSize;
        const size = randInt(min, max);
        // Тема альбома: «залайканный» тег или персонаж/тайтл случайного хорошего поста
        let theme = likedTag;
        if (!theme) {
            const [seed] = await search(defaultTags, 1);
            theme = firstTag(seed?.tag_string_character) ?? firstTag(seed?.tag_string_copyright);
        }
        if (theme) {
            const posts = await freshPosts(await search(themed(theme), size), history, size);
            if (posts.length >= min) {
                const header = `🗂 <b>Подборка:</b> ${escapeHtml(humanizeTag(theme))} ${toHashtag(theme) ?? ''}`;
                const sent = await sendAlbum(telegram, autopost.channelId, posts, { client, userAgent, header });
                if (sent.length) {
                    for (const { message, post } of sent) await remember(deps, message, post);
                    console.log(`✅ Автопост: альбом «${theme}» из ${sent.length} (${rating})`);
                    return 'album';
                }
            }
        }
    }

    const queries = likedTag ? [themed(likedTag), defaultTags] : [defaultTags];
    for (const tags of queries) {
        const posts = await freshPosts(await search(tags, 1), history, 5);
        for (const post of posts) {
            const message = await sendPost(telegram, autopost.channelId, post, { client, userAgent, extra: channelKeyboard(post, client.baseUrl) });
            if (!message) continue;
            await remember(deps, message, post);
            console.log(`✅ Автопост: пост ${post.id} (${rating}${likedTag ? `, по реакциям: ${likedTag}` : ''})`);
            return 'posted';
        }
    }
    return 'empty';
}

/**
 * «⚔️ Битва артов»: два персонажа альбомом + опрос «кто круче?».
 * @returns {Promise<'battle'|null>} null — не получилось собрать битву
 */
async function postBattle({ telegram, client, history, config, channelStats, search, defaultTags, themed, likedTag }) {
    const { autopost, danbooru } = config;

    // Два разных персонажа: из «залайканных» или из случайных хороших постов
    const fighters = [];
    if (likedTag) fighters.push(likedTag);
    const second = await channelStats?.pickLikedTag({ exclude: fighters });
    if (second) fighters.push(second);
    if (fighters.length < 2) {
        for (const post of await search(defaultTags, 10)) {
            const character = firstTag(post.tag_string_character);
            if (character && !fighters.includes(character)) fighters.push(character);
            if (fighters.length === 2) break;
        }
    }
    if (fighters.length < 2) return null;

    const posts = [];
    for (const tag of fighters.slice(0, 2)) {
        const withTag = (await search(themed(tag), 1)).filter(p => (p.tag_string || '').split(' ').includes(tag));
        const [post] = await freshPosts(withTag, history, 1);
        if (!post) return null;
        posts.push(post);
    }

    const [a, b] = fighters.map(humanizeTag);
    const header = `⚔️ <b>Битва артов:</b> ${escapeHtml(a)} vs ${escapeHtml(b)}\nГолосуйте в опросе ниже 👇`;
    const sent = await sendAlbum(telegram, autopost.channelId, posts, { client, userAgent: danbooru.userAgent, header });
    if (sent.length < 2) return null;
    for (const { message, post } of sent) await remember({ history, channelStats }, message, post);

    const poll = await telegram.sendPoll(autopost.channelId, '⚔️ Кто круче?', [
        { text: `1️⃣ ${a}`.slice(0, 100) },
        { text: `2️⃣ ${b}`.slice(0, 100) }
    ], { is_anonymous: true });
    if (poll?.poll?.id) await channelStats?.recordBattle(poll.poll.id, fighters.slice(0, 2));
    console.log(`✅ Автопост: битва ${fighters[0]} vs ${fighters[1]}`);
    return 'battle';
}

/**
 * Бесконечный цикл автопоста для постоянно работающего сервера.
 * При 429 интервал увеличивается, после успеха — возвращается к обычному.
 */
export function startAutopostLoop(deps) {
    const { intervalMs, maxBackoffMs } = deps.config.autopost;
    const { alerts, health } = deps;
    let delay = intervalMs;
    let timer = null;
    let wasQuiet = false;
    let emptyStreak = 0;

    const tick = async () => {
        try {
            const result = await autopostOnce(deps);
            if (result === 'quiet' && !wasQuiet) console.log('🌙 Тихие часы — автопост на паузе');
            if (result !== 'quiet' && wasQuiet) console.log('☀️ Тихие часы закончились');
            wasQuiet = result === 'quiet';
            delay = intervalMs;
            health?.markAutopost(result);
            await alerts?.success('autopost', { label: 'Автопост' });

            emptyStreak = result === 'empty' ? emptyStreak + 1 : 0;
            if (emptyStreak === 10) {
                await alerts?.notify('autopost-empty', 'Автопост 10 раз подряд не нашёл новых картинок. Проверь AUTOPOST-теги и рейтинг.');
            }
        } catch (error) {
            health?.markAutopostError();
            const failures = (await alerts?.failure('autopost', error, { label: 'Автопост' })) ?? 1;
            const rateLimited = error?.isRateLimit || error?.response?.error_code === 429;
            // 429 — сразу увеличиваем паузу; другие ошибки — со второй подряд (Danbooru/Telegram лежат)
            delay = rateLimited || failures >= 2 ? Math.min(delay * 2, maxBackoffMs) : intervalMs;
            console.error(`❌ Ошибка автопоста: ${error.message}${delay > intervalMs ? ` — пауза ${delay / 1000} сек` : ''}`);
        } finally {
            timer = setTimeout(tick, delay);
        }
    };

    timer = setTimeout(tick, 5000);
    return () => clearTimeout(timer);
}
