import path from 'node:path';

const env = process.env;

const toInt = (value, fallback) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
};

export const config = {
    botToken: env.BOT_TOKEN,
    port: toInt(env.PORT, 3000),

    danbooru: {
        baseUrl: env.DANBOORU_URL || 'https://danbooru.donmai.us',
        // Необязательно: с логином и API-ключом лимит тегов выше (Gold+ аккаунты).
        login: env.DANBOORU_LOGIN || '',
        apiKey: env.DANBOORU_API_KEY || '',
        // Анонимам Danbooru разрешает искать максимум по 2 тегам одновременно.
        // Остальные теги бот отфильтрует сам на своей стороне.
        tagLimit: toInt(env.DANBOORU_TAG_LIMIT, 2),
        timeout: 15000,
        userAgent: 'DanbooruTelegramBot/2.0 (+https://github.com/rubaka-pl/Danbooru_bot)'
    },

    search: {
        counts: [1, 3, 5, 10],
        maxGroups: 10,       // максимум строк (отдельных поисков) в одном сообщении
        maxTermsPerGroup: 6, // максимум тегов в одной строке
        sendDelayMs: 1200,   // пауза между картинками, чтобы не упереться в лимиты Telegram
        hourlyLimit: toInt(env.USER_HOURLY_LIMIT, 200) // картинок в час на пользователя (0 — без лимита; админам не действует)
    },

    autopost: {
        enabled: (env.AUTOPOST || 'on').toLowerCase() !== 'off',
        channelId: env.GROUP_ID || '@Obitel_Dionisa',
        intervalMs: toInt(env.AUTOPOST_INTERVAL, 60) * 1000,
        maxBackoffMs: 10 * 60 * 1000,
        tags: ['score:>50', 'date:>=2017-01-01'],
        sensitiveEvery: 5, // каждый N-й пост — rating:sensitive
        // Примерно каждый N-й автопост — альбом из 5–10 картинок (0 — без альбомов)
        albumEvery: toInt(env.ALBUM_EVERY, 8),
        albumSize: [5, 10],
        // Примерно каждый N-й автопост — «⚔️ Битва артов» с опросом (0 — выкл.)
        battleEvery: toInt(env.BATTLE_EVERY, 25),
        // Доля постов, подобранных по статистике реакций в канале (0..1)
        adaptiveShare: Number.parseFloat(env.ADAPTIVE_SHARE ?? '0.4'),
        historyFile: path.resolve(env.HISTORY_FILE || './data/sent_images.json'),
        historyLimit: 5000,
        // В это время автопост в канал не публикует новые картинки.
        // QUIET_HOURS=off — отключить.
        quietHours: parseQuietHours(env.QUIET_HOURS ?? '23:30-06:00'),
        timeZone: env.TZ_NAME || 'Europe/Warsaw',
        // Секрет для /api/autopost (Vercel / внешний cron)
        cronSecret: env.CRON_SECRET || ''
    },

    // «🏆 Топ недели» в канале: день недели (0 — воскресенье) и час. RECAP=off — выключить.
    recap: {
        enabled: (env.RECAP || 'on').toLowerCase() !== 'off',
        weekday: toInt(env.RECAP_WEEKDAY, 0),
        hour: toInt(env.RECAP_HOUR, 20),
        timeZone: env.TZ_NAME || 'Europe/Warsaw'
    },

    subscriptions: {
        hour: toInt(env.DIGEST_HOUR, 12), // рассылка по подпискам — каждый день после этого часа
        timeZone: env.TZ_NAME || 'Europe/Warsaw',
        perSub: 5
    },

    // Кому доступна /stats (id через запятую). Пусто — всем.
    adminIds: (env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean).map(Number),

    // Файл с данными пользователей (избранное, подписки, блок-лист, статистика) для режима polling
    storeFile: path.resolve(env.STORE_FILE || './data/store.json'),

    // Самопинг, чтобы бесплатный Render не усыплял сервис (KEEP_ALIVE=off — выключить)
    keepAliveUrl: (env.KEEP_ALIVE || 'on').toLowerCase() === 'off' ? '' : (env.KEEP_ALIVE_URL || env.RENDER_EXTERNAL_URL || ''),

    // Писать в лог строку на каждое входящее сообщение (LOG_UPDATES=off — выключить)
    logUpdates: (env.LOG_UPDATES || 'on').toLowerCase() !== 'off',

    // Webhook-режим (Vercel). Секрет проверяется в заголовке от Telegram.
    webhookSecret: env.WEBHOOK_SECRET || '',

    // Upstash Redis (на Vercel: Storage → Upstash). Нужен, чтобы помнить отправленное без диска.
    redis: {
        url: env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '',
        token: env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || ''
    }
};

function parseQuietHours(value) {
    const match = String(value).match(/^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/);
    return match ? { start: match[1], end: match[2] } : null;
}
