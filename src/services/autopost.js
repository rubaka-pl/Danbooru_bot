import { findPosts } from './postSearch.js';
import { sendPost } from './sender.js';
import { isQuietTime } from '../utils/quietHours.js';

/**
 * Один автопост в канал.
 * @returns {Promise<'posted'|'quiet'|'empty'>}
 */
export async function autopostOnce({ telegram, client, history, config, now = new Date() }) {
    const { autopost, danbooru } = config;

    if (autopost.quietHours && isQuietTime(now, { ...autopost.quietHours, timeZone: autopost.timeZone })) {
        return 'quiet';
    }

    // Примерно каждый N-й пост — sensitive (случайно, чтобы работало и без состояния)
    const rating = Math.random() < 1 / autopost.sensitiveEvery ? 'sensitive' : 'general';
    const tags = autopost.tags.map(name => ({ name, meta: true, postCount: 0 }));

    const posts = await findPosts(client, { tags, rating, count: 1, tagLimit: danbooru.tagLimit });
    for (const post of posts) {
        if (await history.has(post.md5)) continue;
        const ok = await sendPost(telegram, autopost.channelId, post, { client, userAgent: danbooru.userAgent });
        if (!ok) continue;
        await history.add(post.md5);
        console.log(`✅ Автопост: пост ${post.id} (${rating})`);
        return 'posted';
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
