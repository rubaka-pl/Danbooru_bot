import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasCyrillic, transliterate } from '../src/utils/translit.js';
import { RATINGS, isNsfwTag, ratingFromCode, ratingFromMeta, ratingLabel } from '../src/utils/ratings.js';
import { formatCount } from '../src/utils/format.js';
import { isQuietTime, minutesInZone } from '../src/utils/quietHours.js';
import { isFreeMetatag } from '../src/utils/posts.js';
import { isMetatag } from '../src/utils/query.js';
import { seenFor, tryLock, unlock } from '../src/bot/chatState.js';
import { postKeyboard, searchKeyboard } from '../src/bot/request.js';
import { makePost } from './helpers/fakes.js';

test('транслит', () => {
    assert.equal(hasCyrillic('miku'), false);
    assert.equal(hasCyrillic('Мику'), true);
    assert.equal(transliterate('Наруто Узумаки'), 'naruto uzumaki');
    assert.equal(transliterate('щука_ёж'), 'schuka_yozh');
});

test('рейтинги', () => {
    assert.equal(ratingLabel('explicit'), RATINGS.explicit.label);
    assert.equal(ratingLabel('nope'), RATINGS.general.label);
    assert.equal(ratingFromMeta('q'), 'explicit');
    assert.equal(ratingFromMeta('S'), 'sensitive');
    assert.equal(ratingFromMeta('zzz'), null);
    assert.equal(ratingFromMeta(undefined), null);
    assert.equal(ratingFromCode('s'), 'sensitive');
    assert.equal(ratingFromCode('x'), 'general');
    assert.equal(isNsfwTag('nude'), true);
    assert.equal(isNsfwTag('yuri'), false);
});

test('formatCount', () => {
    assert.equal(formatCount(999), '999');
    assert.equal(formatCount(1000), '1k');
    assert.equal(formatCount(12_345), '12.3k');
    assert.equal(formatCount(2_000_000), '2M');
});

test('тихие часы: без настроек, одинаковое время, дневной интервал', () => {
    const date = new Date('2024-01-01T13:05:00Z');
    assert.equal(minutesInZone(date, 'UTC'), 13 * 60 + 5);
    assert.equal(isQuietTime(date, { start: null, end: null, timeZone: 'UTC' }), false);
    assert.equal(isQuietTime(date, { start: '10:00', end: '10:00', timeZone: 'UTC' }), false);
    assert.equal(isQuietTime(date, { start: '13:00', end: '14', timeZone: 'UTC' }), true);
});

test('метатеги: бесплатные для лимита и распознавание', () => {
    assert.equal(isFreeMetatag('score:>5'), true);
    assert.equal(isFreeMetatag('order:rank'), false);
    assert.equal(isMetatag('order:rank'), true);
    assert.equal(isMetatag('re:zero'), false);
});

test('chatState: блокировка и «уже видел» с ограничением', () => {
    assert.equal(tryLock('c1'), true);
    assert.equal(tryLock('c1'), false);
    unlock('c1');
    assert.equal(tryLock('c1'), true);
    unlock('c1');

    const seen = seenFor('c2');
    for (let i = 0; i < 2001; i++) seen.add(`m${i}`);
    assert.equal(seen.has('m0'), false);
    assert.equal(seen.has('m2000'), true);
    assert.equal(seenFor('c2').has('m2000'), true);
});

test('клавиатуры', () => {
    const search = searchKeyboard('sensitive', [1, 3]).reply_markup.inline_keyboard;
    assert.equal(search.length, 3);
    assert.ok(search[0].some(b => b.text.startsWith('✅') && b.callback_data === 'r:sensitive'));
    assert.deepEqual(search[2].map(b => b.callback_data), ['s:sensitive:1', 's:sensitive:3']);
    assert.equal(searchKeyboard('general', [1], { subscribe: true }).reply_markup.inline_keyboard.at(-1)[0].callback_data, 'sub:general');

    const full = postKeyboard(makePost({ id: 5 })).reply_markup.inline_keyboard;
    assert.deepEqual(full.flat().map(b => b.callback_data), ['f:5', 'sim:5', 'dl:5', 'art:5', 'chr:5']);
    const bare = postKeyboard(makePost({ id: 6, tag_string_artist: '', tag_string_character: ' ' })).reply_markup.inline_keyboard;
    assert.deepEqual(bare.flat().map(b => b.callback_data), ['f:6', 'sim:6', 'dl:6']);
});
