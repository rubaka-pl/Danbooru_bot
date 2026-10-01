import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIqdbHtml, reverseSearch } from '../src/services/reverseSearch.js';
import { fakeClient, mockFetch } from './helpers/fakes.js';

const HTML = `
<table><tr><th>Your image</th></tr></table>
<table><tr><th>Best match</th></tr><tr><td><a href="//danbooru.donmai.us/posts/123"><img></a></td></tr><tr><td>96% similarity</td></tr></table>
<table><tr><th>Possible match</th></tr><tr><td><a href="https://danbooru.donmai.us/posts/456"></a></td></tr><tr><td>71% similarity</td></tr></table>
<table><tr><td>мусор без ссылки</td></tr></table>`;

test('parseIqdbHtml', () => {
    assert.deepEqual(parseIqdbHtml(HTML), [{ postId: 123, score: 96 }, { postId: 456, score: 71 }]);
    assert.deepEqual(parseIqdbHtml('<html></html>'), []);
});

test('reverseSearch: результаты IQDB Danbooru отсортированы', async () => {
    const client = fakeClient({
        similarToFile: async () => [{ postId: 1, score: 60, post: { id: 1 } }, { postId: 2, score: 90, post: { id: 2 } }]
    });
    const result = await reverseSearch(client, Buffer.from([1]));
    assert.deepEqual(result.map(r => r.postId), [2, 1]);
});

test('reverseSearch: запасной iqdb.org и дотягивание постов', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const fetchMock = mockFetch(async () => new Response(HTML));
    try {
        const client = fakeClient({ similarToFile: async () => { throw new Error('403'); } });
        const result = await reverseSearch(client, Buffer.from([1]), { userAgent: 'ua' });
        assert.deepEqual(result.map(r => [r.postId, r.score, r.post.id]), [[123, 96, 123], [456, 71, 456]]);
        assert.equal(fetchMock.calls[0].url, 'https://danbooru.iqdb.org/');
    } finally {
        fetchMock.restore();
    }
});

test('reverseSearch: оба сервиса недоступны → пусто', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const fetchMock = mockFetch(async () => new Response('err', { status: 500 }));
    try {
        const client = fakeClient({ similarToFile: async () => [] });
        assert.deepEqual(await reverseSearch(client, Buffer.from([1])), []);
    } finally {
        fetchMock.restore();
    }
});

test('reverseSearch: посты, которые не удалось загрузить, отбрасываются', async () => {
    const client = fakeClient({
        similarToFile: async () => [{ postId: 9, score: 90, post: null }],
        postsByIds: async () => { throw new Error('down'); }
    });
    assert.deepEqual(await reverseSearch(client, Buffer.from([1])), []);
});
