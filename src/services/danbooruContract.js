/*
 * Проверка «контракта» с Danbooru: те ли поля и ответы, на которые рассчитан бот.
 * Запускается раз в неделю в GitHub Actions (scripts/checkDanbooru.js) —
 * если Danbooru поменяет API, владелец узнает сразу, а не когда бот сломается.
 */

const has = (obj, ...fields) => fields.every(f => obj && obj[f] !== undefined);

/**
 * @returns {Promise<Array<{ name: string, ok: boolean, required: boolean, details?: string }>>}
 */
export async function runContractChecks(client) {
    const results = [];
    let samplePost = null;

    async function check(name, fn, { required = true } = {}) {
        try {
            const details = await fn();
            results.push({ name, ok: true, required, details });
        } catch (error) {
            results.push({ name, ok: false, required, details: error.message });
        }
    }

    const assert = (condition, message) => {
        if (!condition) throw new Error(message);
    };

    await check('Поиск постов (posts.json, random)', async () => {
        const posts = await client.posts({ tags: ['hatsune_miku', 'rating:g'], limit: 5, random: true });
        assert(Array.isArray(posts) && posts.length > 0, 'пустой ответ');
        samplePost = posts.find(p => p.file_url) ?? posts[0];
        assert(has(samplePost, 'id', 'md5', 'rating', 'file_ext', 'tag_string', 'tag_string_character', 'created_at'), 'нет нужных полей поста');
        assert(samplePost.large_file_url || samplePost.file_url, 'нет ссылок на файл');
        return `${posts.length} постов`;
    });

    await check('Лимит тегов (ожидаем 422 на 3 тега)', async () => {
        try {
            await client.posts({ tags: ['hatsune_miku', 'smile', 'long_hair'], limit: 1, random: true });
        } catch (error) {
            assert(error.isTagLimit, `другая ошибка: ${error.message}`);
            return 'бот корректно распознаёт ошибку лимита';
        }
        return 'лимит не сработал (возможно, аккаунт с большим лимитом) — не страшно';
    }, { required: false });

    await check('Тег по имени (tags.json)', async () => {
        const tag = await client.tagByName('hatsune_miku');
        assert(has(tag, 'name', 'post_count', 'category'), 'нет полей тега');
        return `${tag.post_count} постов`;
    });

    await check('Алиасы (tag_aliases.json)', async () => {
        await client.aliasOf('miku');
        return 'ok';
    });

    await check('Автодополнение (autocomplete.json)', async () => {
        const items = await client.autocomplete('hatsune');
        assert(items.length > 0 && items[0].value, 'пустое автодополнение или нет поля value');
        return items[0].value;
    });

    await check('Опечатки (fuzzy_name_matches)', async () => {
        const items = await client.tagsFuzzy('hatsune_mku');
        assert(items.some(t => t.name === 'hatsune_miku'), 'не нашёл hatsune_miku по опечатке');
        return 'ok';
    }, { required: false });

    await check('Популярное (explore/posts/popular.json)', async () => {
        const posts = await client.popular({ scale: 'week' });
        assert(Array.isArray(posts), 'не массив');
        return `${posts.length} постов`;
    });

    await check('Вики (wiki_pages)', async () => {
        const page = await client.wiki('hatsune_miku');
        assert(page && typeof page.body === 'string', 'нет поля body');
        return 'ok';
    }, { required: false });

    await check('Связанные теги (related_tag.json)', async () => {
        const tags = await client.relatedTags('hatsune_miku');
        assert(tags.length > 0, 'пусто');
        return `${tags.length} тегов`;
    }, { required: false });

    await check('Похожие картинки (IQDB)', async () => {
        assert(samplePost, 'нет поста для проверки');
        const matches = await client.similarToPost(samplePost.id, 3);
        assert(matches.length > 0 && matches[0].score !== undefined, 'нет совпадений или поля score');
        return `${matches.length} совпадений`;
    }, { required: false });

    return results;
}

export function formatContractReport(results) {
    return results
        .map(r => `${r.ok ? '✅' : r.required ? '❌' : '⚠️'} ${r.name}${r.details ? ` — ${r.details}` : ''}`)
        .join('\n');
}
