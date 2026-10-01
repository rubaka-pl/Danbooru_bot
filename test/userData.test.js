import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/services/store.js';
import { createUserData } from '../src/services/userData.js';
import { createChannelStats, rankTags, statTags, totalReactions } from '../src/services/channelStats.js';
import { makePost } from './helpers/fakes.js';

test('избранное: переключение, порядок, лимит 500', async () => {
    const { favorites } = createUserData(new MemoryStore());
    assert.equal(await favorites.toggle(1, 10), true);
    assert.equal(await favorites.toggle(1, 11), true);
    assert.deepEqual(await favorites.list(1), [11, 10]);
    assert.equal(await favorites.toggle(1, 10), false);
    await favorites.remove(1, 11);
    assert.deepEqual(await favorites.list(1), []);
    for (let i = 0; i < 510; i++) await favorites.toggle(2, i);
    const list = await favorites.list(2);
    assert.equal(list.length, 500);
    assert.equal(list[0], 509);
});

test('блок-лист: добавление без дублей, удаление, фильтр', async () => {
    const { blocklist } = createUserData(new MemoryStore());
    const none = await blocklist.matcher(1);
    assert.equal(none(makePost()), false);

    assert.deepEqual(await blocklist.add(1, ['yaoi', 'guro']), ['yaoi', 'guro']);
    assert.deepEqual(await blocklist.add(1, ['yaoi', 'x']), ['x']);
    const match = await blocklist.matcher(1);
    assert.equal(match(makePost({ tag_string: 'a guro b' })), true);
    assert.equal(match(makePost({ tag_string: 'guro_fan' })), false);
    assert.equal(match({}), false);
    assert.equal(await blocklist.remove(1, ['guro', 'nope']), 1);
    assert.deepEqual(await blocklist.list(1), ['yaoi', 'x']);
});

test('подписки: добавление, дубли, лимит, удаление, индекс чатов', async () => {
    const { subscriptions } = createUserData(new MemoryStore());
    const sub = (tags) => ({ tags, rating: 'general', lastId: 0 });
    assert.deepEqual(await subscriptions.add(1, sub(['a'])), { ok: true });
    assert.deepEqual(await subscriptions.add(1, sub(['a'])), { ok: false, reason: 'exists' });
    await subscriptions.add(2, sub(['b']));
    assert.deepEqual(await subscriptions.chats(), [1, 2]);
    for (let i = 0; i < 9; i++) await subscriptions.add(1, sub([`t${i}`]));
    assert.deepEqual(await subscriptions.add(1, sub(['over'])), { ok: false, reason: 'limit' });

    assert.equal(await subscriptions.removeAt(1, 99), null);
    assert.deepEqual((await subscriptions.removeAt(2, 0)).tags, ['b']);
    assert.deepEqual(await subscriptions.chats(), [1]);

    const list = await subscriptions.list(1);
    list[0].lastId = 5;
    await subscriptions.save(1, list);
    assert.equal((await subscriptions.list(1))[0].lastId, 5);

    await subscriptions.forgetChat(1);
    assert.deepEqual(await subscriptions.list(1), []);
    assert.deepEqual(await subscriptions.chats(), []);
});

test('statTags и totalReactions', () => {
    assert.deepEqual(statTags(makePost({ tag_string_copyright: 'original vocaloid', tag_string_artist: 'x' })),
        ['hatsune_miku', 'vocaloid', 'x']);
    assert.equal(totalReactions([{ total_count: 2 }, { total_count: 3 }, {}]), 5);
    assert.equal(totalReactions(), 0);
});

test('rankTags: учитывает число постов и сглаживает', () => {
    const ranked = rankTags({ a: [10, 50], b: [2, 20], c: [1, 100], d: [5, 0] });
    assert.deepEqual(ranked.map(r => r.tag), ['b', 'a', 'd']); // c отсеян (1 пост), у b среднее выше
    assert.deepEqual(rankTags({}), []);
});

test('статистика канала: запись постов, реакции, топ, выбор тега', async () => {
    const stats = createChannelStats(new MemoryStore());
    assert.equal(await stats.pickLikedTag(), null);
    assert.equal(await stats.updateReactions(999, 5), false);

    await stats.recordPost(1, makePost({ tag_string_character: 'rem', tag_string_copyright: '', tag_string_artist: '' }));
    await stats.recordPost(2, makePost({ tag_string_character: 'rem', tag_string_copyright: '', tag_string_artist: '' }));
    await stats.recordPost(3, makePost({ tag_string_character: 'ram', tag_string_copyright: '', tag_string_artist: '' }));
    await stats.recordPost(4, makePost({ tag_string_character: 'ram', tag_string_copyright: '', tag_string_artist: '' }));

    assert.equal(await stats.updateReactions(1, 10), true);
    assert.equal(await stats.updateReactions(1, 10), true); // без изменений
    await stats.updateReactions(1, 6); // реакцию сняли
    await stats.updateReactions(3, 1);

    const top = await stats.top();
    assert.deepEqual(top.map(t => [t.tag, t.reactions]), [['rem', 6], ['ram', 1]]);

    const picks = new Set();
    for (let i = 0; i < 50; i++) picks.add(await stats.pickLikedTag());
    assert.ok(picks.has('rem'));
    assert.ok([...picks].every(t => t === 'rem' || t === 'ram'));
});

test('статистика канала: не больше 1000 тегов', async () => {
    const store = new MemoryStore();
    const big = {};
    for (let i = 0; i < 1005; i++) big[`t${i}`] = [i + 1, 0];
    await store.set('ch:tagstats', big);
    const stats = createChannelStats(store);
    await stats.recordPost(1, makePost({ tag_string_character: 'new_tag', tag_string_copyright: '', tag_string_artist: '' }));
    const saved = await store.get('ch:tagstats');
    assert.equal(Object.keys(saved).length, 1000);
    assert.ok(saved.t1004);
    assert.equal(saved.t0, undefined);
});
