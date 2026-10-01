import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPolling, logUpdates } from '../src/bot/launch.js';

const silent = { log() {}, warn() {}, error() {} };
const tgError = (code) => Object.assign(new Error(`Telegram ${code}`), { response: { error_code: code } });

function fakeBot(results, webhookUrl = '') {
    const launches = [];
    return {
        launches,
        telegram: { getWebhookInfo: async () => ({ url: webhookUrl }) },
        async launch(options, onLaunch) {
            launches.push(options);
            const next = results.shift();
            if (next instanceof Error) throw next;
            onLaunch?.();
        }
    };
}

test('launchPolling: обычный запуск', async () => {
    let launched = false;
    const bot = fakeBot([undefined], 'https://old.vercel.app/api/webhook');
    const warnings = [];
    await launchPolling(bot, { allowedUpdates: ['message'], onLaunch: () => { launched = true; }, log: { ...silent, warn: (m) => warnings.push(m) } });
    assert.equal(launched, true);
    assert.deepEqual(bot.launches, [{ dropPendingUpdates: true, allowedUpdates: ['message'] }]);
    assert.match(warnings[0], /webhook/);
});

test('launchPolling: 409 — ждёт, уведомляет админа и пробует снова', async () => {
    const notes = [];
    const errors = [];
    const bot = fakeBot([tgError(409), tgError(409), undefined]);
    await launchPolling(bot, {
        retryMs: 1,
        alerts: { notify: async (key, text) => notes.push([key, text]) },
        log: { ...silent, error: (m) => errors.push(m) }
    });
    assert.equal(bot.launches.length, 3);
    assert.equal(bot.launches[1].dropPendingUpdates, false);
    assert.match(errors[0], /другая копия бота/);
    assert.equal(notes[0][0], 'conflict');
});

test('launchPolling: неверный токен и прочие ошибки пробрасываются', async () => {
    const errors = [];
    await assert.rejects(launchPolling(fakeBot([tgError(401)]), { log: { ...silent, error: (m) => errors.push(m) } }), /401/);
    assert.match(errors[0], /Неверный BOT_TOKEN/);
    await assert.rejects(launchPolling(fakeBot([new Error('network')]), { log: silent }), /network/);
});

test('logUpdates: команда, текст, кнопка, inline', async () => {
    const lines = [];
    const mw = logUpdates({ log: (m) => lines.push(m) });
    const next = async () => 'next';
    assert.equal(await mw({ updateType: 'message', chat: { type: 'private', id: 5 }, message: { text: '/start@bot x' } }, next), 'next');
    await mw({ updateType: 'message', chat: { type: 'private', id: 5 }, message: { text: 'miku' } }, next);
    await mw({ updateType: 'callback_query', chat: { type: 'private', id: 5 }, callbackQuery: { data: 's:general:3' } }, next);
    await mw({ updateType: 'inline_query', from: { id: 7 } }, next);
    await mw({ updateType: 'poll' }, next);
    assert.deepEqual(lines, [
        '📩 message (private 5) /start@bot',
        '📩 message (private 5) текст',
        '📩 callback_query (private 5) кнопка s',
        '📩 inline_query (user 7)',
        '📩 poll (user ?)'
    ]);
});

import { startKeepAlive } from '../src/services/keepAlive.js';

test('keep-alive: без адреса выключен, с адресом пингует /health', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const logs = [];
    const log = { log: (m) => logs.push(m), warn: (m) => logs.push(m) };
    startKeepAlive({ url: '', log })();
    assert.equal(logs.length, 0);

    const calls = [];
    let fail = false;
    const stop = startKeepAlive({
        url: 'https://bot.onrender.com',
        intervalMs: 1000,
        log,
        fetchImpl: async (url) => { calls.push(url); if (fail) throw new Error('timeout'); return new Response('ok'); }
    });
    assert.match(logs[0], /bot\.onrender\.com\/health/);
    t.mock.timers.tick(1000);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['https://bot.onrender.com/health']);
    fail = true;
    t.mock.timers.tick(1000);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(logs.at(-1), /не ответил: timeout/);
    stop();
});
