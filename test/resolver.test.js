import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTagResolver } from '../src/services/tagResolver.js';

const TAGS = {
    uzumaki_naruto: 50000,
    hatsune_miku: 100000,
    swimsuit: 300000,
    naruto: 60000,
    breasts: 2000000,
    rem_re_zero: 0
};
const ALIASES = { boobs: 'breasts' };

const fakeClient = {
    async tagByName(name) {
        return name in TAGS ? { name, post_count: TAGS[name], category: 0 } : null;
    },
    async aliasOf(name) {
        return ALIASES[name] ?? null;
    },
    async autocomplete(q) {
        if (q === 'miku') return [{ value: 'hatsune_miku', post_count: 100000 }];
        if (q === 'rem') return [{ value: 'rem_(re:zero)', post_count: 40000 }];
        return [];
    },
    async tagsMatching() {
        return [];
    }
};

test('точное совпадение', async () => {
    const r = createTagResolver(fakeClient);
    assert.deepEqual((await r.resolve('hatsune_miku')).map(t => t.name), ['hatsune_miku']);
});

test('обратный порядок имени', async () => {
    const r = createTagResolver(fakeClient);
    assert.deepEqual((await r.resolve('naruto_uzumaki')).map(t => t.name), ['uzumaki_naruto']);
});

test('алиасы', async () => {
    const r = createTagResolver(fakeClient);
    assert.deepEqual((await r.resolve('boobs')).map(t => t.name), ['breasts']);
});

test('автодополнение', async () => {
    const r = createTagResolver(fakeClient);
    assert.deepEqual((await r.resolve('rem')).map(t => t.name), ['rem_(re:zero)']);
});

test('несколько слов → несколько тегов', async () => {
    const r = createTagResolver(fakeClient);
    assert.deepEqual((await r.resolve('miku_swimsuit')).map(t => t.name), ['hatsune_miku', 'swimsuit']);
});

test('кириллица через транслит', async () => {
    const r = createTagResolver(fakeClient);
    assert.deepEqual((await r.resolve('наруто')).map(t => t.name), ['naruto']);
    assert.deepEqual((await r.resolve('мику')).map(t => t.name), ['hatsune_miku']);
});

test('ничего не найдено', async () => {
    const r = createTagResolver(fakeClient);
    assert.deepEqual(await r.resolve('qwertyuiop'), []);
});

test('поиск по подстроке, если автодополнение пустое', async () => {
    const client = { ...fakeClient, tagsMatching: async (pattern) => (pattern === '*genshin*' ? [{ name: 'genshin_impact', post_count: 9 }] : []) };
    const r = createTagResolver(client);
    assert.deepEqual((await r.resolve('genshin')).map(t => t.name), ['genshin_impact']);
});

test('автодополнение: пропускает метатеги, доверяет подсказке без тега', async () => {
    const client = {
        ...fakeClient,
        autocomplete: async () => [{ value: 'order:rank' }, { value: 'new_tag', post_count: 3, category: 4 }]
    };
    const r = createTagResolver(client);
    assert.deepEqual(await r.resolve('newt'), [{ name: 'new_tag', postCount: 3, category: 4 }]);
});

test('алиас на пустой тег не принимается; ошибки API не роняют поиск', async () => {
    const client = {
        ...fakeClient,
        aliasOf: async (name) => (name === 'old' ? 'rem_re_zero' : null),
        autocomplete: async () => { throw new Error('500'); },
        tagsMatching: async () => { throw new Error('500'); }
    };
    const r = createTagResolver(client);
    assert.deepEqual(await r.resolve('old'), []);
});

test('429 от Danbooru пробрасывается', async () => {
    const client = { ...fakeClient, tagByName: async () => { throw Object.assign(new Error('429'), { isRateLimit: true }); } };
    await assert.rejects(createTagResolver(client).resolve('x'), /429/);
});

test('кэш: повторный запрос не ходит в API, старые записи вытесняются', async () => {
    let calls = 0;
    const client = { ...fakeClient, tagByName: async (name) => { calls++; return { name, post_count: 1 }; } };
    const r = createTagResolver(client, { cacheSize: 2 });
    await r.resolve('a');
    await r.resolve('a');
    assert.equal(calls, 1);
    await r.resolve('b');
    await r.resolve('c');
    await r.resolve('a');
    assert.equal(calls, 4);
});

test('составные слова: частично найденные не принимаются', async () => {
    const client = { ...fakeClient, autocomplete: async (q) => (q === 'miku' ? [{ value: 'hatsune_miku', post_count: 1 }] : []) };
    const r = createTagResolver(client);
    assert.deepEqual(await r.resolve('miku_qwertyuiop'), []);
});

test('resolveGroup: метатеги, исключения, дубли и ненайденное', async () => {
    const r = createTagResolver(fakeClient);
    const group = await r.resolveGroup({
        label: 'x',
        terms: [
            { kind: 'tag', tag: 'hatsune_miku', raw: 'hatsune miku', negated: false },
            { kind: 'tag', tag: 'miku', raw: 'miku', negated: false },
            { kind: 'meta', tag: 'score:>5', raw: 'score:>5', negated: false },
            { kind: 'tag', tag: 'swimsuit', raw: 'swimsuit', negated: true },
            { kind: 'tag', tag: 'zzz', raw: 'zzz', negated: false }
        ]
    });
    assert.deepEqual(group.tags.map(t => [t.name, t.negated, Boolean(t.meta)]), [
        ['hatsune_miku', false, false],
        ['score:>5', false, true],
        ['swimsuit', true, false]
    ]);
    assert.deepEqual(group.unresolved, ['zzz']);
});
