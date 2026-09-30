import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, matchesClientFilter, pickMedia } from '../src/utils/posts.js';
import { findPosts } from '../src/services/postSearch.js';
import { DanbooruError } from '../src/services/danbooru.js';

const base = 'https://danbooru.donmai.us';

test('buildQuery соблюдает лимит тегов и отправляет редкие на сервер', () => {
    const q = buildQuery([
        { name: '1girl', postCount: 5_000_000 },
        { name: 'hatsune_miku', postCount: 100_000 },
        { name: 'swimsuit', postCount: 300_000 },
        { name: 'male_focus', postCount: 1, negated: true }
    ], 'general', 2);
    assert.deepEqual(q.serverTags, ['hatsune_miku', 'swimsuit']);
    assert.deepEqual(q.clientInclude, ['1girl']);
    assert.deepEqual(q.clientExclude, ['male_focus']);
    assert.equal(q.ratingCode, 'g');
});

test('matchesClientFilter', () => {
    const post = { rating: 'g', tag_string: 'hatsune_miku 1girl smile' };
    assert.ok(matchesClientFilter(post, { clientInclude: ['1girl'], clientExclude: ['male_focus'] }));
    assert.ok(!matchesClientFilter(post, { clientInclude: ['2girls'] }));
    assert.ok(!matchesClientFilter(post, { clientExclude: ['smile'] }));
    assert.ok(!matchesClientFilter(post, { ratingCode: 'e' }));
});

test('pickMedia', () => {
    assert.deepEqual(pickMedia({ file_ext: 'png', file_url: 'https://x/a.png', large_file_url: 'https://x/s.jpg' }, base),
        { type: 'photo', url: 'https://x/s.jpg' });
    assert.equal(pickMedia({ file_ext: 'webm', file_url: 'https://x/a.webm' }, base), null);
    assert.equal(pickMedia({ file_ext: 'jpg' }, base), null); // скрытый пост без ссылок
    assert.equal(pickMedia({ file_ext: 'mp4', file_url: 'https://x/a.mp4', file_size: 1000 }, base).type, 'video');
});

test('findPosts при ошибке лимита тегов переносит рейтинг и теги на клиент', async () => {
    const calls = [];
    const client = {
        baseUrl: base,
        async posts({ tags }) {
            calls.push(tags);
            if (tags.length > 1) throw new DanbooruError('You cannot search for more than 1 tag at a time', 422);
            return [
                { id: 1, md5: 'a', rating: 'g', file_ext: 'jpg', file_url: 'u1', tag_string: 'miku smile' },
                { id: 2, md5: 'b', rating: 'e', file_ext: 'jpg', file_url: 'u2', tag_string: 'miku smile' },
                { id: 3, md5: 'c', rating: 'g', file_ext: 'jpg', file_url: 'u3', tag_string: 'miku' }
            ];
        }
    };
    const posts = await findPosts(client, {
        tags: [{ name: 'miku', postCount: 1 }, { name: 'smile', postCount: 2 }],
        rating: 'general',
        count: 3,
        tagLimit: 2
    });
    assert.deepEqual(posts.map(p => p.id), [1]);
    assert.deepEqual(calls.at(-1), ['miku']);
});
