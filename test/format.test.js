import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaption, toHashtag, humanizeTag, CAPTION_LIMIT } from '../src/utils/format.js';

test('toHashtag делает валидные хэштеги', () => {
    assert.equal(toHashtag('saber_(fate)'), '#saber_fate');
    assert.equal(toHashtag('hatsune_miku'), '#hatsune_miku');
    assert.equal(toHashtag(':d'), '#d');
    assert.equal(toHashtag('^_^'), null);
    assert.equal(toHashtag('1girl'), '#1girl');
    assert.equal(toHashtag('00'), null);
});

test('humanizeTag', () => {
    assert.equal(humanizeTag('saber_(fate)'), 'Saber (Fate)');
});

test('подпись не длиннее лимита и экранирует HTML', () => {
    const post = {
        id: 1,
        tag_string_artist: 'a<b>',
        tag_string_character: 'hatsune_miku',
        tag_string_copyright: 'vocaloid',
        tag_string_general: Array.from({ length: 500 }, (_, i) => `very_long_general_tag_${i}`).join(' '),
        created_at: '2024-01-02T03:04:05Z'
    };
    const caption = buildCaption(post, { postUrl: 'https://danbooru.donmai.us/posts/1' });
    assert.ok(caption.replace(/<[^>]+>/g, '').length <= CAPTION_LIMIT);
    assert.ok(caption.includes('A&lt;b&gt;'));
    assert.ok(caption.includes('#hatsune_miku'));
    assert.ok(caption.includes('2024-01-02'));
});

test('подпись: очень длинные имена урезаются до лимита', () => {
    const long = 'x'.repeat(400);
    const post = {
        tag_string_artist: `${long}_a ${long}_b ${long}_c`,
        tag_string_character: `${long}_d ${long}_e`,
        tag_string_copyright: long,
        tag_string_general: '',
        created_at: '2024-01-01T00:00:00Z'
    };
    const caption = buildCaption(post, { postUrl: 'https://danbooru.donmai.us/posts/1', query: 'q' });
    assert.ok(caption.replace(/<[^>]+>/g, '').length <= CAPTION_LIMIT);
    assert.match(caption, /Открыть на Danbooru/);
});

test('подпись: компактная для альбома', () => {
    assert.equal(buildCaption({ tag_string_artist: '', tag_string_character: '' }, { compact: true }), '');
    assert.equal(buildCaption({ tag_string_character: 'rem' }, { compact: true, postUrl: 'u' }), 'Rem <a href="u">🔗</a>');
});
