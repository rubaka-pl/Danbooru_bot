import { test } from 'node:test';
import assert from 'node:assert/strict';

// Конфиг читает переменные окружения при импорте — импортируем с разными env
async function loadConfig(env) {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
        const { config } = await import(`../src/config.js?${Math.random()}`);
        return config;
    } finally {
        for (const key of Object.keys(env)) {
            if (key in saved) process.env[key] = saved[key];
            else delete process.env[key];
        }
    }
}

test('значения по умолчанию', async () => {
    const config = await loadConfig({});
    assert.equal(config.danbooru.tagLimit, 2);
    assert.equal(config.autopost.enabled, true);
    assert.equal(config.autopost.intervalMs, 60_000);
    assert.deepEqual(config.autopost.quietHours, { start: '23:30', end: '06:00' });
    assert.equal(config.autopost.timeZone, 'Europe/Warsaw');
    assert.equal(config.autopost.albumEvery, 8);
    assert.equal(config.subscriptions.hour, 12);
    assert.deepEqual(config.adminIds, []);
});

test('переменные окружения', async () => {
    const config = await loadConfig({
        AUTOPOST: 'OFF',
        AUTOPOST_INTERVAL: '15',
        QUIET_HOURS: ' 22:00 - 07:30 ',
        TZ_NAME: 'Europe/Moscow',
        DANBOORU_TAG_LIMIT: '6',
        ALBUM_EVERY: '0',
        ADAPTIVE_SHARE: '0.7',
        DIGEST_HOUR: '9',
        ADMIN_IDS: '1, 2,,3',
        KV_REST_API_URL: 'https://kv',
        KV_REST_API_TOKEN: 'tok'
    });
    assert.equal(config.autopost.enabled, false);
    assert.equal(config.autopost.intervalMs, 15_000);
    assert.deepEqual(config.autopost.quietHours, { start: '22:00', end: '07:30' });
    assert.equal(config.autopost.timeZone, 'Europe/Moscow');
    assert.equal(config.danbooru.tagLimit, 6);
    assert.equal(config.autopost.albumEvery, 0);
    assert.equal(config.autopost.adaptiveShare, 0.7);
    assert.equal(config.subscriptions.hour, 9);
    assert.deepEqual(config.adminIds, [1, 2, 3]);
    assert.deepEqual(config.redis, { url: 'https://kv', token: 'tok' });
});

test('keep-alive: адрес Render, свой адрес, выключение', async () => {
    assert.equal((await loadConfig({ RENDER_EXTERNAL_URL: 'https://x.onrender.com' })).keepAliveUrl, 'https://x.onrender.com');
    assert.equal((await loadConfig({ RENDER_EXTERNAL_URL: 'https://x', KEEP_ALIVE_URL: 'https://y' })).keepAliveUrl, 'https://y');
    assert.equal((await loadConfig({ RENDER_EXTERNAL_URL: 'https://x', KEEP_ALIVE: 'off' })).keepAliveUrl, '');
    assert.equal((await loadConfig({ LOG_UPDATES: 'off' })).logUpdates, false);
});

test('QUIET_HOURS=off и мусор в числах', async () => {
    const config = await loadConfig({ QUIET_HOURS: 'off', AUTOPOST_INTERVAL: 'abc' });
    assert.equal(config.autopost.quietHours, null);
    assert.equal(config.autopost.intervalMs, 60_000);
});
