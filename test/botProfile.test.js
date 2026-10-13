import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanBotProfile, DEFAULT_DESCRIPTION, isSuspicious } from '../src/services/botProfile.js';

const silent = { log() {}, warn() {} };

test('isSuspicious: фишинг — да, свои ссылки и обычный текст — нет', () => {
    assert.equal(isSuspicious('Register on our site and get free telegram premium ❤️\n🔥 https://vxodess.top/premium_gift'), true);
    assert.equal(isSuspicious('Заходи на example.org'), true);
    assert.equal(isSuspicious(DEFAULT_DESCRIPTION), false);
    assert.equal(isSuspicious('Арты с https://danbooru.donmai.us · t.me/Obitel_Dionisa'), false);
    assert.equal(isSuspicious('Danbooru pictures'), false);
    assert.equal(isSuspicious(''), false);
});

test('cleanBotProfile: основное описание — своё, языковые версии — удаляются, имя по умолчанию не трогает', async () => {
    const spam = 'free telegram premium https://vxodess.top/premium_gift';
    const profile = {
        'getMyDescription:': { description: spam },
        'getMyDescription:ru': { description: spam },
        'getMyShortDescription:en': { short_description: spam },
        'getMyName:': { name: 'Get premium gift' },
        'getMyName:uk': { name: 'Free premium' }
    };
    const sets = [];
    const telegram = {
        async callApi(method, payload) {
            if (method.startsWith('set')) { sets.push([method, payload]); return true; }
            if (payload.language_code === 'xx') throw new Error('LANG_CODE_INVALID');
            return profile[`${method}:${payload.language_code ?? ''}`] ?? {};
        }
    };
    const fixed = await cleanBotProfile(telegram, { delayMs: 0, log: silent });
    assert.deepEqual(fixed, ['description', 'short_description:en', 'description:ru', 'name:uk']);
    assert.deepEqual(sets[0], ['setMyDescription', { description: DEFAULT_DESCRIPTION }]);
    assert.ok(sets.some(([m, p]) => m === 'setMyDescription' && p.language_code === 'ru' && p.description === ''));
    assert.deepEqual(sets.at(-1), ['setMyName', { language_code: 'uk', name: '' }]);
});

test('cleanBotProfile: 429 — ждёт и повторяет, чистый профиль — ничего не меняет', async () => {
    let first = true;
    const sets = [];
    const telegram = {
        async callApi(method) {
            if (method.startsWith('set')) { sets.push(method); return true; }
            if (first) {
                first = false;
                throw Object.assign(new Error('Too Many Requests'), { response: { error_code: 429, parameters: { retry_after: 0 } } });
            }
            return {};
        }
    };
    assert.deepEqual(await cleanBotProfile(telegram, { delayMs: 0, log: silent }), []);
    assert.deepEqual(sets, []);
});
