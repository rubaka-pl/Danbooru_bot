import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQuietTime } from '../src/utils/quietHours.js';
import { formatGroupLine, parseGroupsFromMessage } from '../src/bot/request.js';

const quiet = { start: '23:30', end: '06:00', timeZone: 'UTC' };
const at = (hhmm) => new Date(`2024-06-01T${hhmm}:00Z`);

test('тихие часы 23:30–06:00', () => {
    assert.equal(isQuietTime(at('23:29'), quiet), false);
    assert.equal(isQuietTime(at('23:30'), quiet), true);
    assert.equal(isQuietTime(at('02:00'), quiet), true);
    assert.equal(isQuietTime(at('05:59'), quiet), true);
    assert.equal(isQuietTime(at('06:00'), quiet), false);
    assert.equal(isQuietTime(at('15:00'), quiet), false);
});

test('тихие часы учитывают часовой пояс', () => {
    // 22:00 UTC = 00:00 в Варшаве летом
    assert.equal(isQuietTime(at('22:00'), { ...quiet, timeZone: 'Europe/Warsaw' }), true);
    assert.equal(isQuietTime(at('22:00'), quiet), false);
});

test('запрос переживает круг "сообщение → текст → разбор"', () => {
    const line = formatGroupLine([
        { name: 'swimsuit', postCount: 300000 },
        { name: 'saber_(fate)', postCount: 1000 },
        { name: 'male_focus', negated: true, postCount: 5 },
        { name: 'score:>50', meta: true, postCount: 0 }
    ]);
    // Telegram отдаёт текст без HTML
    const plain = line.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
    const [tags] = parseGroupsFromMessage(`🔎 Понял так:\n${plain}\nРейтинг: x`);
    assert.deepEqual(tags.map(t => [t.name, t.negated, t.meta]), [
        ['score:>50', false, true],
        ['saber_(fate)', false, false],
        ['swimsuit', false, false],
        ['male_focus', true, false]
    ]);
});
