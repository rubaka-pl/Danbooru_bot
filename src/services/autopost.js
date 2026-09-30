import { findPosts } from './postSearch.js';
import { sendAlbum, sendPost } from './sender.js';
import { escapeHtml, humanizeTag, toHashtag } from '../utils/format.js';
import { isQuietTime } from '../utils/quietHours.js';

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

async function remember({ history, channelStats }, message, post) {
    await history.add(post.md5);
    await channelStats?.recordPost(message.message_id, post).catch(error => console.warn('⚠️ Статистика:', error.message));
}

/**
 * Один автопост в канал: обычно одна картинка, иногда альбом.
 * Часть постов подбирается по тегам, которые собирают больше всего реакций.
 * @param {boolean} [deps.force] — игнорировать паузу и тихие часы (команда /post)
 * @returns {Promise<'posted'|'album'|'quiet'|'paused'|'empty'>}
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
    const defaultTags = autopost.tags.map(name => ({ name, meta: true, postCount: 0 }));
    const themed = (tag) => [{ name: tag, postCount: 0 }, { name: 'score:>20', meta: true, postCount: 0 }];
    const search = (tags, count) => findPosts(client, { tags, rating, count, tagLimit: danbooru.tagLimit });
    const userAgent = danbooru.userAgent;

    const likedTag = Math.random() < autopost.adaptiveShare ? await channelStats?.pickLikedTag() : null;
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
            const message = await sendPost(telegram, autopost.channelId, post, { client, userAgent });
            if (!message) continue;
            await remember(deps, message, post);
            console.log(`✅ Автопост: пост ${post.id} (${rating}${likedTag ? `, по реакциям: ${likedTag}` : ''})`);
            return 'posted';
        }
    }
    return 'empty';
}

/**
 * Бесконечный цикл автопоста для постоянно работающего сервера.
 * При 429 интервал увеличивается, после успеха — возвращается к обычному.
 */
export function startAutopostLoop(deps) {
    const { intervalMs, maxBackoffMs } = deps.config.autopost;
    let delay = intervalMs;
    let timer = null;
    let wasQuiet = false;

    const tick = async () => {
        try {
            const result = await autopostOnce(deps);
            if (result === 'quiet' && !wasQuiet) console.log('🌙 Тихие часы — автопост на паузе');
            if (result !== 'quiet' && wasQuiet) console.log('☀️ Тихие часы закончились');
            wasQuiet = result === 'quiet';
            delay = intervalMs;
        } catch (error) {
            const rateLimited = error?.isRateLimit || error?.response?.error_code === 429;
            delay = rateLimited ? Math.min(delay * 2, maxBackoffMs) : intervalMs;
            console.error(`❌ Ошибка автопоста: ${error.message}${rateLimited ? ` — пауза ${delay / 1000} сек` : ''}`);
        } finally {
            timer = setTimeout(tick, delay);
        }
    };

    timer = setTimeout(tick, 5000);
    return () => clearTimeout(timer);
}
