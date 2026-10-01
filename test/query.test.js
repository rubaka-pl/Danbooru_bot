import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUserInput, normalizeTag } from '../src/utils/query.js';

test('normalizeTag', () => {
    assert.equal(normalizeTag('  Hatsune   Miku '), 'hatsune_miku');
    assert.equal(normalizeTag('#saber_(fate)'), 'saber_(fate)');
    assert.equal(normalizeTag('Re:Zero'), 're:zero');
});

test('одна строка с запятыми — одна группа из нескольких тегов', () => {
    const { groups, rating } = parseUserInput('Rem, maid, -male focus');
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].terms.map(t => [t.tag, t.negated]), [
        ['rem', false], ['maid', false], ['male_focus', true]
    ]);
    assert.equal(rating, null);
});

test('несколько строк — несколько групп', () => {
    const { groups } = parseUserInput('naruto\n\nhatsune miku\n');
    assert.deepEqual(groups.map(g => g.terms[0].tag), ['naruto', 'hatsune_miku']);
});

test('ключевые слова рейтинга не становятся тегами', () => {
    assert.equal(parseUserInput('rem nsfw').rating, 'explicit');
    assert.deepEqual(parseUserInput('rem nsfw').groups[0].terms.map(t => t.tag), ['rem']);
    assert.equal(parseUserInput('miku, safe').rating, 'general');
    assert.equal(parseUserInput('miku, rating:e').rating, 'explicit');
    assert.equal(parseUserInput('18+').groups.length, 0);
});

test('метатеги и теги с двоеточием', () => {
    const [group] = parseUserInput('miku, score:>100, re:zero').groups;
    assert.deepEqual(group.terms.map(t => t.kind), ['tag', 'meta', 'tag']);
});

test('хэштеги из подписи', () => {
    const [group] = parseUserInput('#hatsune_miku #vocaloid').groups;
    assert.deepEqual(group.terms.map(t => t.tag), ['hatsune_miku', 'vocaloid']);
});

test('кириллица не теряется', () => {
    const [group] = parseUserInput('Мику').groups;
    assert.equal(group.terms[0].tag, 'мику');
});
