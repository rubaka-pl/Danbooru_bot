import { findPosts } from './postSearch.js';
import { sendAlbum, sendPost } from './sender.js';
import { minutesInZone } from '../utils/quietHours.js';
import { escapeHtml } from '../utils/format.js';
import { isMetatag } from '../utils/query.js';
import { postKeyboard } from '../bot/request.js';
import { isAdult } from '../utils/ratings.js';
import { runRecapIfDue } from './recap.js';

const LAST_RUN_KEY = 'subs:lastRun';

/** Строка тега из подписки ("-male_focus") → объект тега для поиска */
export function subTagsToQuery(tags) {
    return tags.map((raw, index) => {
        const negated = raw.startsWith('-');
        const name = negated ? raw.slice(1) : raw;
        return { name, negated, meta: isMetatag(name), postCount: index };
    });
}

/** Дата (YYYY-MM-DD) в нужном часовом поясе */
export function dateInZone(date, timeZone) {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Самый свежий id поста по тегам — чтобы подписка присылала только новое. */
export async function latestPostId(client, tags, rating, tagLimit) {
    const posts = await findPosts(client, { tags, rating, count: 1, tagLimit, random: false, limit: 20 });
    return posts.reduce((max, p) => Math.max(max, p.id), 0);
}

/**
 * Новые арты по подпискам одного чата.
 * @returns {Promise<number>} сколько подписок что-то прислали
 */
export async function deliverForChat({ telegram, client, config, userData }, chatId) {
    const subs = await userData.subscriptions.list(chatId);
    if (!subs.length) return 0;

    const blocked = await userData.blocklist.matcher(chatId);
    const { safe } = await userData.settings.get(chatId);
    const { perSub } = config.subscriptions;
    const userAgent = config.danbooru.userAgent;
    let delivered = 0;
    let changed = false;

    for (const sub of subs) {
        const posts = await findPosts(client, {
            tags: subTagsToQuery(sub.tags),
            rating: sub.rating,
            count: perSub,
            tagLimit: config.danbooru.tagLimit,
            random: false,
            limit: 100
        });

        const maxId = posts.reduce((max, p) => Math.max(max, p.id), sub.lastId ?? 0);
        const fresh = posts.filter(p => p.id > (sub.lastId ?? 0) && !blocked(p) && !(safe && isAdult(p)));
        if (maxId > (sub.lastId ?? 0)) {
            sub.lastId = maxId;
            changed = true;
        }
        if (!fresh.length) continue;

        const best = fresh.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, perSub);
        const header = `📬 <b>Подписка:</b> ${escapeHtml(sub.tags.join(' + '))} — новых: ${fresh.length}`;

        const album = best.length >= 2
            ? await sendAlbum(telegram, chatId, best, { client, userAgent, header })
            : [];
        if (!album.length) {
            await sendPost(telegram, chatId, best[0], { client, userAgent, header, extra: postKeyboard(best[0]) });
        }
        delivered++;
    }

    if (changed) await userData.subscriptions.save(chatId, subs);
    return delivered;
}

/**
 * Ежедневная рассылка. Запускается, если наступил час рассылки и сегодня её ещё не было.
 * @returns {Promise<{ status: 'not_due'|'done', chats?: number, delivered?: number }>}
 */
export async function runDigestIfDue(deps, { now = new Date(), force = false } = {}) {
    const { store, userData, config } = deps;
    const { hour, timeZone } = config.subscriptions;
    const today = dateInZone(now, timeZone);

    if (!force) {
        if (minutesInZone(now, timeZone) < hour * 60) return { status: 'not_due' };
        if ((await store.get(LAST_RUN_KEY)) === today) return { status: 'not_due' };
    }
    await store.set(LAST_RUN_KEY, today);

    const chats = await userData.subscriptions.chats();
    let delivered = 0;
    for (const chatId of chats) {
        try {
            delivered += await deliverForChat(deps, chatId);
        } catch (error) {
            const code = error?.response?.error_code;
            if (code === 403 || code === 400 && /chat not found/i.test(error.message)) {
                console.log(`📭 Чат ${chatId} недоступен — удаляю подписки`);
                await userData.subscriptions.forgetChat(chatId);
            } else {
                console.error(`❌ Подписки для ${chatId}:`, error.message);
            }
        }
    }
    console.log(`📬 Рассылка по подпискам: чатов ${chats.length}, доставлено ${delivered}`);
    return { status: 'done', chats: chats.length, delivered };
}

/** Проверка раз в 10 минут — для постоянно работающего сервера (рассылка + «Топ недели»). */
export function startDigestLoop(deps) {
    const tick = async () => {
        await runDigestIfDue(deps).catch(error => console.error('❌ Рассылка:', error.message));
        await runRecapIfDue(deps).catch(error => console.error('❌ Топ недели:', error.message));
    };
    const timer = setInterval(tick, 10 * 60 * 1000);
    setTimeout(tick, 30 * 1000);
    return () => clearInterval(timer);
}
