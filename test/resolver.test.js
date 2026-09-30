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
