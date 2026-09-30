import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, ALLOWED_UPDATES } from '../src/app.js';
import { config } from '../src/config.js';
import { FileStore, MemoryStore, RedisStore } from '../src/services/store.js';
import { FileHistory, MemoryHistory, RedisHistory } from '../src/services/history.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('createApp: без токена — ошибка', () => {
    const saved = config.botToken;
    config.botToken = '';
    try {
        assert.throws(() => createApp(), /BOT_TOKEN/);
    } finally {
        config.botToken = saved;
    }
});

test('createApp выбирает хранилище по окружению', (t) => {
    t.mock.method(console, 'warn', () => {});
    const saved = { token: config.botToken, redis: { ...config.redis } };
    config.botToken = '1:x';
    try {
        config.redis = { url: '', token: '' };
        const file = createApp();
        assert.ok(file.store instanceof FileStore);
        assert.ok(file.history instanceof FileHistory);

        const memory = createApp({ serverless: true });
        assert.ok(memory.store instanceof MemoryStore);
        assert.ok(memory.history instanceof MemoryHistory);

        config.redis = { url: 'https://r', token: 't' };
        const redis = createApp({ serverless: true });
        assert.ok(redis.store instanceof RedisStore);
        assert.ok(redis.history instanceof RedisHistory);
        assert.ok(ALLOWED_UPDATES.includes('message_reaction_count'));
    } finally {
        config.botToken = saved.token;
        config.redis = saved.redis;
    }
});

function run(args, env) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, args, {
            cwd: root,
            env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';
        child.stdout.on('data', (d) => { output += d; });
        child.stderr.on('data', (d) => { output += d; });
        const timer = setTimeout(() => child.kill('SIGTERM'), 15000);
        child.on('exit', (code) => {
            clearTimeout(timer);
            resolve({ code, output });
        });
    });
}

test('src/index.js: поднимает health-check и падает с понятной ошибкой без доступа к Telegram', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-run-'));
    const { code, output } = await run(['src/index.js'], {
        BOT_TOKEN: '1:invalid',
        PORT: '0',
        AUTOPOST: 'off',
        HISTORY_FILE: path.join(dir, 'h.json'),
        STORE_FILE: path.join(dir, 's.json'),
        // Заведомо недоступный адрес, чтобы тест не зависел от сети
        HTTPS_PROXY: 'http://127.0.0.1:9',
        https_proxy: 'http://127.0.0.1:9'
    });
    assert.match(output, /Health-check/);
    assert.match(output, /Не удалось запустить бота/);
    assert.equal(code, 1);
});

test('src/index.js: без BOT_TOKEN сразу падает', async () => {
    const { code, output } = await run(['src/index.js'], {});
    assert.notEqual(code, 0);
    assert.match(output, /BOT_TOKEN/);
});

test('scripts/setWebhook.js: проверяет переменные', async () => {
    const noToken = await run(['scripts/setWebhook.js'], {});
    assert.equal(noToken.code, 1);
    assert.match(noToken.output, /Нужен BOT_TOKEN/);

    const noUrl = await run(['scripts/setWebhook.js'], { BOT_TOKEN: '1:x' });
    assert.equal(noUrl.code, 1);
    assert.match(noUrl.output, /Нужен WEBHOOK_URL/);
});
