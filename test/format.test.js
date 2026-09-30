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
