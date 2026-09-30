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

test('buildQuery: random занимает слот, бесплатные метатеги — нет', () => {
    const tags = [
        { name: 'score:>50', meta: true, postCount: 0 },
        { name: 'order:rank', meta: true, postCount: 0 },
        { name: 'a', postCount: 1 },
        { name: 'b', postCount: 2 }
    ];
    const q = buildQuery(tags, 'any', 3, { random: true });
    assert.deepEqual(q.serverTags, ['score:>50', 'order:rank', 'a']);
    assert.deepEqual(q.clientInclude, ['b']);
    assert.equal(q.ratingCode, null);
});

test('findPosts: в random-режиме добивает свежими постами с полным набором тегов', async () => {
    const calls = [];
    const client = {
        baseUrl: base,
        async posts(params) {
            calls.push(params);
            return params.random
                ? [{ id: 1, md5: 'a', rating: 'g', file_ext: 'jpg', file_url: 'u', tag_string: 'x y' }]
                : [
                    { id: 1, md5: 'a', rating: 'g', file_ext: 'jpg', file_url: 'u', tag_string: 'x y' },
                    { id: 2, md5: 'b', rating: 'g', file_ext: 'jpg', file_url: 'u', tag_string: 'x y' }
                ];
        }
    };
    const posts = await findPosts(client, {
        tags: [{ name: 'x', postCount: 1 }, { name: 'y', postCount: 2 }],
        rating: 'general', count: 3, tagLimit: 2
    });
    assert.deepEqual(posts.map(p => p.id), [1, 2]);
    assert.deepEqual(calls.map(c => [c.random, c.tags]), [[true, ['x', 'rating:g']], [false, ['x', 'y', 'rating:g']]]);
});

test('findPosts: удалённые и забаненные отбрасываются, другие ошибки пробрасываются', async () => {
    const client = {
        baseUrl: base,
        posts: async () => [
            { id: 1, md5: 'a', rating: 'g', file_ext: 'jpg', file_url: 'u', is_deleted: true },
            { id: 2, md5: 'b', rating: 'g', file_ext: 'jpg', file_url: 'u', is_banned: true },
            { id: 3, md5: 'c', rating: 'g', file_ext: 'jpg', file_url: 'u' }
        ]
    };
    const posts = await findPosts(client, { tags: [], rating: 'general', count: 1, skip: (p) => p.id === 99 });
    assert.deepEqual(posts.map(p => p.id), [3]);

    const failing = { baseUrl: base, posts: async () => { throw new Error('boom'); } };
    await assert.rejects(findPosts(failing, { tags: [], rating: 'general', count: 1 }), /boom/);

    const alwaysLimit = { baseUrl: base, posts: async () => { throw new DanbooruError('too many tags', 422); } };
    await assert.rejects(findPosts(alwaysLimit, { tags: [{ name: 'a', postCount: 1 }], rating: 'general', count: 1, tagLimit: 3, random: false }), /too many tags/);
});

test('pickMedia: относительные ссылки, большие gif/mp4', () => {
    assert.equal(pickMedia({ file_ext: 'jpg', file_url: '/data/a.jpg' }, base).url, `${base}/data/a.jpg`);
    assert.equal(pickMedia({ file_ext: 'gif', file_url: 'https://x/a.gif', file_size: 30 * 1024 * 1024 }, base), null);
    assert.equal(pickMedia({ file_ext: 'gif', file_size: 1 }, base), null);
    assert.equal(pickMedia({ file_ext: 'mp4', file_size: 1 }, base), null);
});
