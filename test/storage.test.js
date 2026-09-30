import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileStore, MemoryStore, RedisStore } from '../src/services/store.js';
import { FileHistory, MemoryHistory, RedisHistory } from '../src/services/history.js';
import { createRedis } from '../src/services/redis.js';
import { mockFetch, jsonResponse } from './helpers/fakes.js';

const tmpFile = async (name) => path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'danbooru-bot-')), 'sub', name);

/** Фейковый Upstash: хранит данные в Map, понимает GET/SET/DEL/EXISTS. */
function fakeUpstash() {
    const data = new Map();
    return mockFetch(async (url, init) => {
        const [cmd, key, value, ...rest] = JSON.parse(init.body);
        assert.equal(init.headers.Authorization, 'Bearer tok');
        switch (cmd) {
            case 'GET': return jsonResponse({ result: data.get(key) ?? null });
            case 'SET': data.set(key, value); return jsonResponse({ result: rest.length ? 'OK' : 'OK' });
            case 'DEL': data.delete(key); return jsonResponse({ result: 1 });
            case 'EXISTS': return jsonResponse({ result: data.has(key) ? 1 : 0 });
            default: return jsonResponse({ error: 'unknown' }, 400);
        }
    });
}

for (const [name, make] of [['MemoryStore', async () => new MemoryStore()], ['FileStore', async () => new FileStore(await tmpFile('store.json'))]]) {
    test(`${name}: get/set/del и копии значений`, async () => {
        const store = await make();
        await store.load();
        assert.equal(await store.get('missing'), null);
        const value = { a: [1, 2] };
        await store.set('k', value);
        value.a.push(3);
        assert.deepEqual(await store.get('k'), { a: [1, 2] });
        const copy = await store.get('k');
        copy.a.push(9);
        assert.deepEqual(await store.get('k'), { a: [1, 2] });
        await store.del('k');
        assert.equal(await store.get('k'), null);
    });

    test(`${name}: TTL`, async () => {
        const store = await make();
        await store.set('t', 1, { ttlSeconds: -1 });
        assert.equal(await store.get('t'), null);
        await store.set('t2', 2, { ttlSeconds: 100 });
        assert.equal(await store.get('t2'), 2);
    });
}

test('FileStore переживает перезапуск и чистит просроченное', async () => {
    const file = await tmpFile('store.json');
    const a = new FileStore(file);
    await a.set('keep', { x: 1 });
    await a.set('old', 1, { ttlSeconds: -1 });
    const b = new FileStore(file);
    await b.load();
    assert.deepEqual(await b.get('keep'), { x: 1 });
    assert.equal(b.data.old, undefined);

    await fs.writeFile(file, 'не json');
    const c = new FileStore(file);
    await c.load();
    assert.deepEqual(c.data, {});
});

test('RedisStore через Upstash REST', async () => {
    const upstash = fakeUpstash();
    try {
        const store = new RedisStore({ url: 'https://redis.example/', token: 'tok' });
        await store.load();
        assert.equal(await store.get('x'), null);
        await store.set('x', { hello: 'мир' }, { ttlSeconds: 60 });
        assert.deepEqual(await store.get('x'), { hello: 'мир' });
        const setCall = JSON.parse(upstash.calls.find(c => c.init.body.includes('"SET"')).init.body);
        assert.deepEqual(setCall.slice(0, 2), ['SET', 'danbooru:x']);
        assert.deepEqual(setCall.slice(3), ['EX', '60']);
        await store.del('x');
        assert.equal(await store.get('x'), null);
        assert.equal(upstash.calls[0].url, 'https://redis.example');
    } finally {
        upstash.restore();
    }
});

test('RedisStore: битый JSON → null; ошибка Redis → исключение', async () => {
    const f = mockFetch(async (url, init) => (JSON.parse(init.body)[0] === 'GET'
        ? jsonResponse({ result: '{oops' })
        : jsonResponse({ error: 'ERR' }, 500)));
    try {
        const store = new RedisStore({ url: 'https://r', token: 'tok' });
        assert.equal(await store.get('k'), null);
        await assert.rejects(store.set('k', 1), /ERR/);
    } finally {
        f.restore();
    }
});

test('createRedis: HTTP-ошибка без тела', async () => {
    const f = mockFetch(async () => new Response('bad', { status: 502 }));
    try {
        await assert.rejects(createRedis({ url: 'https://r', token: 't' })('PING'), /Redis HTTP 502/);
    } finally {
        f.restore();
    }
});

test('FileHistory: лимит, повторное добавление, сохранение и загрузка', async (t) => {
    t.mock.method(console, 'log', () => {});
    const file = await tmpFile('history.json');
    const history = new FileHistory(file, 3);
    await history.load();
    for (const md5 of ['a', 'b', 'c', 'a', 'd']) await history.add(md5);
    await history.add(undefined);
    assert.equal(await history.has('b'), false); // вытеснен
    assert.equal(await history.has('a'), true);  // был «освежён»

    const reloaded = new FileHistory(file, 3);
    await reloaded.load();
    assert.deepEqual([...reloaded.items], ['c', 'a', 'd']);
});

test('MemoryHistory', async () => {
    const history = new MemoryHistory(2);
    await history.load();
    await history.add('a');
    await history.add('b');
    await history.add('c');
    assert.equal(await history.has('a'), false);
    assert.equal(await history.has('c'), true);
});

test('RedisHistory: EXISTS/SET с TTL и устойчивость к ошибкам', async () => {
    const upstash = fakeUpstash();
    try {
        const history = new RedisHistory({ url: 'https://r', token: 'tok', ttlDays: 1 });
        await history.load();
        assert.equal(await history.has('m'), false);
        await history.add('m');
        await history.add('');
        assert.equal(await history.has('m'), true);
        const set = JSON.parse(upstash.calls.find(c => c.init.body.includes('"SET"')).init.body);
        assert.deepEqual(set, ['SET', 'danbooru:sent:m', '1', 'EX', '86400']);
    } finally {
        upstash.restore();
    }

    const broken = mockFetch(async () => { throw new Error('offline'); });
    try {
        const history = new RedisHistory({ url: 'https://r', token: 'tok' });
        assert.equal(await history.has('m'), false);
        await history.add('m'); // не бросает
    } finally {
        broken.restore();
    }
});
