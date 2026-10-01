import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sendAlbum, sendPost } from '../src/services/sender.js';
import { fakeClient, makePost, mockFetch } from './helpers/fakes.js';

const client = fakeClient();
const opts = { client, userAgent: 'ua' };

function fakeTelegram(behaviour = {}) {
    const calls = [];
    const make = (method) => async (chatId, media, options) => {
        calls.push({ method, chatId, media, options });
        if (behaviour[method]) return behaviour[method](media, calls.length);
        return method === 'sendMediaGroup' ? media.map((_, i) => ({ message_id: i + 1 })) : { message_id: 1 };
    };
    return {
        calls,
        sendPhoto: make('sendPhoto'),
        sendAnimation: make('sendAnimation'),
        sendVideo: make('sendVideo'),
        sendMediaGroup: make('sendMediaGroup')
    };
}

let fetchMock;
afterEach(() => fetchMock?.restore());

test('sendPost: фото по ссылке с HTML-подписью и доп. параметрами', async () => {
    const tg = fakeTelegram();
    const message = await sendPost(tg, 1, makePost({ id: 3 }), { ...opts, header: '<b>H</b>', extra: { reply_markup: { x: 1 } } });
    assert.deepEqual(message, { message_id: 1 });
    const [call] = tg.calls;
    assert.equal(call.method, 'sendPhoto');
    assert.match(call.media, /original\/3\.jpg/);
    assert.equal(call.options.parse_mode, 'HTML');
    assert.match(call.options.caption, /^<b>H<\/b>/);
    assert.deepEqual(call.options.reply_markup, { x: 1 });
});

test('sendPost: gif и mp4, неподдерживаемые форматы', async () => {
    const tg = fakeTelegram();
    await sendPost(tg, 1, makePost({ file_ext: 'gif', file_url: 'https://x/a.gif' }), opts);
    await sendPost(tg, 1, makePost({ file_ext: 'mp4', file_url: 'https://x/a.mp4' }), opts);
    assert.deepEqual(tg.calls.map(c => c.method), ['sendAnimation', 'sendVideo']);
    assert.equal(await sendPost(tg, 1, makePost({ file_ext: 'webm' }), opts), null);
});

test('sendPost: запасная загрузка файлом и полный провал', async () => {
    fetchMock = mockFetch(async () => new Response(new Uint8Array([1, 2])));
    const tg = fakeTelegram({ sendPhoto: (media) => { if (typeof media === 'string') throw new Error('bad url'); return { message_id: 9 }; } });
    const message = await sendPost(tg, 1, makePost({ id: 4 }), opts);
    assert.deepEqual(message, { message_id: 9 });
    assert.match(tg.calls[0].media, /original/);
    assert.match(tg.calls[1].media, /sample/);
    assert.equal(tg.calls[2].media.filename, 'danbooru_4.jpg');
    assert.equal(fetchMock.calls[0].init.headers['User-Agent'], 'ua');
    fetchMock.restore();

    fetchMock = mockFetch(async () => new Response('no', { status: 404 }));
    const failing = fakeTelegram({ sendPhoto: () => { throw new Error('bad url'); } });
    assert.equal(await sendPost(failing, 1, makePost(), opts), null);
    fetchMock.restore();

    fetchMock = mockFetch(async () => new Response(new Uint8Array(11 * 1024 * 1024)));
    assert.equal(await sendPost(failing, 1, makePost(), opts), null);
});

test('sendPost: 429 от Telegram пробрасывается', async () => {
    const rateLimit = Object.assign(new Error('Too Many Requests'), { response: { error_code: 429 } });
    const tg = fakeTelegram({ sendPhoto: () => { throw rateLimit; } });
    await assert.rejects(sendPost(tg, 1, makePost(), opts), /Too Many/);

    fetchMock = mockFetch(async () => new Response(new Uint8Array([1])));
    let n = 0;
    const second = fakeTelegram({ sendPhoto: () => { if (n++ === 0) throw new Error('bad'); throw rateLimit; } });
    await assert.rejects(sendPost(second, 1, makePost(), opts), /Too Many/);
});

test('sendAlbum: полная подпись у первой, короткие у остальных, без gif', async () => {
    const tg = fakeTelegram();
    const posts = [makePost({ id: 1 }), makePost({ id: 2, file_ext: 'gif', file_url: 'https://x/a.gif' }), makePost({ id: 3 })];
    const sent = await sendAlbum(tg, 1, posts, { ...opts, header: 'HEAD' });
    assert.deepEqual(sent.map(s => s.post.id), [1, 3]);
    const media = tg.calls[0].media;
    assert.match(media[0].caption, /^HEAD/);
    assert.match(media[1].caption, /Hatsune Miku · 🎨 Some Artist/);
    assert.equal(media[1].parse_mode, 'HTML');

    assert.deepEqual(await sendAlbum(tg, 1, [makePost()], opts), []);
});

test('sendAlbum: если ссылки не прошли — загружает файлы; 429 пробрасывает', async () => {
    fetchMock = mockFetch(async () => new Response(new Uint8Array([1])));
    const tg = fakeTelegram({ sendMediaGroup: (media) => { if (typeof media[0].media === 'string') throw new Error('bad'); return media.map(() => ({ message_id: 5 })); } });
    const sent = await sendAlbum(tg, 1, [makePost(), makePost()], opts);
    assert.equal(sent.length, 2);
    assert.match(tg.calls[0].media[0].media, /original/);
    assert.match(tg.calls[1].media[0].media, /sample/);
    assert.ok(tg.calls[2].media[0].media.source);

    // Оригиналы не прошли, копии — да
    const second = fakeTelegram({ sendMediaGroup: (media, n) => { if (n === 1) throw new Error('bad'); return media.map(() => ({ message_id: 6 })); } });
    assert.equal((await sendAlbum(second, 1, [makePost(), makePost()], opts)).length, 2);
    assert.equal(second.calls.length, 2);

    const rateLimit = Object.assign(new Error('429'), { response: { error_code: 429 } });
    const limited = fakeTelegram({ sendMediaGroup: () => { throw rateLimit; } });
    await assert.rejects(sendAlbum(limited, 1, [makePost(), makePost()], opts), /429/);
});

test('sendPost: 403 и «chat not found» пробрасываются без повторной загрузки', async () => {
    fetchMock = mockFetch(async () => new Response(new Uint8Array([1])));
    const forbidden = Object.assign(new Error('Forbidden'), { response: { error_code: 403 } });
    const notFound = Object.assign(new Error('Bad Request'), { response: { error_code: 400, description: 'Bad Request: chat not found' } });
    for (const error of [forbidden, notFound]) {
        const tg = fakeTelegram({ sendPhoto: () => { throw error; } });
        await assert.rejects(sendPost(tg, 1, makePost(), opts), error);
    }
    assert.equal(fetchMock.calls.length, 0);
});
