import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDanbooruClient, DanbooruError } from '../src/services/danbooru.js';
import { jsonResponse } from './helpers/fakes.js';

function makeClient(handler, extra = {}) {
    const calls = [];
    const client = createDanbooruClient({
        baseUrl: 'https://danbooru.donmai.us',
        userAgent: 'test-agent',
        fetchImpl: async (url, init) => {
            calls.push({ url: new URL(url), init });
            return handler(new URL(url), init);
        },
        ...extra
    });
    return { client, calls };
}

test('posts: параметры запроса и заголовки', async () => {
    const { client, calls } = makeClient(() => jsonResponse([{ id: 1 }]));
    const posts = await client.posts({ tags: ['a', 'rating:g'], limit: 5, random: true, page: 2 });
    assert.deepEqual(posts, [{ id: 1 }]);
    const { url, init } = calls[0];
    assert.equal(url.pathname, '/posts.json');
    assert.equal(url.searchParams.get('tags'), 'a rating:g');
    assert.equal(url.searchParams.get('random'), 'true');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(init.headers['User-Agent'], 'test-agent');

    await client.posts({ tags: [] });
    assert.equal(calls[1].url.searchParams.has('random'), false);
    assert.equal(calls[1].url.searchParams.has('tags'), false);
});

test('логин и API-ключ добавляются к запросу', async () => {
    const { client, calls } = makeClient(() => jsonResponse([]), { login: 'me', apiKey: 'key' });
    await client.posts();
    assert.equal(calls[0].url.searchParams.get('login'), 'me');
    assert.equal(calls[0].url.searchParams.get('api_key'), 'key');
});

test('ошибки: лимит тегов, 429, недоступность, не-JSON, неверный формат', async () => {
    const tagLimit = makeClient(() => jsonResponse({ success: false, message: 'You cannot search for more than 2 tags at a time' }, 422)).client;
    const error = await tagLimit.posts().catch(e => e);
    assert.ok(error instanceof DanbooruError);
    assert.equal(error.isTagLimit, true);
    assert.equal(error.isRateLimit, false);

    const limited = await makeClient(() => new Response('slow down', { status: 429 })).client.posts().catch(e => e);
    assert.equal(limited.isRateLimit, true);
    assert.equal(limited.message, 'HTTP 429');

    const offline = await makeClient(() => { throw new Error('ECONNRESET'); }).client.posts().catch(e => e);
    assert.match(offline.message, /Danbooru недоступен/);
    assert.equal(offline.status, 0);

    await assert.rejects(makeClient(() => jsonResponse({ oops: 1 })).client.posts(), /Некорректный ответ/);
    await assert.rejects(makeClient(() => jsonResponse({ oops: 1 })).client.popular(), /Некорректный ответ/);
});

test('post, postsByIds, popular, postUrl', async () => {
    const { client, calls } = makeClient((url) => jsonResponse(url.pathname.startsWith('/posts/') ? { id: 7 } : [{ id: 1 }]));
    assert.deepEqual(await client.post('7'), { id: 7 });
    assert.equal(calls[0].url.pathname, '/posts/7.json');

    assert.deepEqual(await client.postsByIds([]), []);
    await client.postsByIds([3, '4']);
    assert.equal(calls[1].url.searchParams.get('tags'), 'id:3,4');

    await client.popular({ scale: 'week' });
    assert.equal(calls[2].url.pathname, '/explore/posts/popular.json');
    assert.equal(calls[2].url.searchParams.get('scale'), 'week');
    assert.equal(calls[2].url.searchParams.get('limit'), '100');

    assert.equal(client.postUrl(5), 'https://danbooru.donmai.us/posts/5');
});

test('теги: по имени, алиас, автодополнение, поиск по маске', async () => {
    const { client, calls } = makeClient((url) => {
        if (url.pathname === '/tag_aliases.json') return jsonResponse([{ consequent_name: 'breasts' }]);
        if (url.pathname === '/autocomplete.json') return jsonResponse([{ value: 'x' }]);
        return jsonResponse([{ name: 'n', post_count: 1 }]);
    });
    assert.deepEqual(await client.tagByName('n'), { name: 'n', post_count: 1 });
    assert.equal(calls[0].url.searchParams.get('search[name]'), 'n');
    assert.equal(await client.aliasOf('boobs'), 'breasts');
    assert.equal(calls[1].url.searchParams.get('search[status]'), 'active');
    assert.deepEqual(await client.autocomplete('mi'), [{ value: 'x' }]);
    assert.equal(calls[2].url.searchParams.get('search[type]'), 'tag_query');
    await client.tagsMatching('*mi*');
    assert.equal(calls[3].url.searchParams.get('search[order]'), 'count');

    const empty = makeClient(() => jsonResponse({})).client;
    assert.equal(await empty.tagByName('x'), null);
    assert.equal(await empty.aliasOf('x'), null);
    assert.deepEqual(await empty.autocomplete('x'), []);
    assert.deepEqual(await empty.tagsMatching('x'), []);
});

test('IQDB: по посту (GET) и по файлу (POST multipart)', async () => {
    const { client, calls } = makeClient(() => jsonResponse([
        { post_id: 1, score: 97.5, post: { id: 1 } },
        { post_id: 2, similarity: '80' },
        { score: 50 } // без id — отбрасывается
    ]));
    const byPost = await client.similarToPost(5, 3);
    assert.deepEqual(byPost, [
        { post: { id: 1 }, postId: 1, score: 97.5 },
        { post: null, postId: 2, score: 80 }
    ]);
    assert.equal(calls[0].url.pathname, '/iqdb_queries.json');
    assert.equal(calls[0].url.searchParams.get('search[post_id]'), '5');

    await client.similarToFile(Buffer.from([1, 2]), 'a.png');
    assert.equal(calls[1].init.method, 'POST');
    assert.ok(calls[1].init.body instanceof FormData);
    assert.ok(calls[1].init.body.has('search[file]'));

    const weird = makeClient(() => jsonResponse({ error: 1 })).client;
    assert.deepEqual(await weird.similarToPost(1), []);
});
