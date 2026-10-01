/*
 * Поиск источника картинки: сначала IQDB самого Danbooru,
 * если он недоступен — публичный danbooru.iqdb.org.
 */

const IQDB_ORG = 'https://danbooru.iqdb.org/';

/** Разбор HTML-ответа iqdb.org → [{ postId, score }] */
export function parseIqdbHtml(html) {
    const results = [];
    const tables = html.split('<table').slice(1);
    for (const table of tables) {
        if (/Your image/i.test(table)) continue;
        const id = table.match(/danbooru\.donmai\.us\/posts\/(\d+)/)?.[1];
        const score = table.match(/(\d+)% similarity/)?.[1];
        if (id && score) results.push({ postId: Number(id), score: Number(score) });
    }
    return results;
}

async function searchIqdbOrg(buffer, filename, userAgent) {
    const form = new FormData();
    form.append('file', new Blob([buffer]), filename);
    const res = await fetch(IQDB_ORG, {
        method: 'POST',
        body: form,
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) throw new Error(`iqdb.org HTTP ${res.status}`);
    return parseIqdbHtml(await res.text());
}

/**
 * @returns {Promise<Array<{ post: object, score: number }>>} отсортировано по сходству
 */
export async function reverseSearch(client, buffer, { filename = 'image.jpg', userAgent } = {}) {
    let matches = [];
    try {
        matches = await client.similarToFile(buffer, filename);
    } catch (error) {
        console.warn('⚠️ IQDB Danbooru недоступен, пробую iqdb.org:', error.message);
    }

    if (!matches.length) {
        try {
            matches = await searchIqdbOrg(buffer, filename, userAgent);
        } catch (error) {
            console.warn('⚠️ iqdb.org:', error.message);
        }
    }

    matches.sort((a, b) => b.score - a.score);
    const top = matches.slice(0, 5);

    // Дотягиваем данные постов, которых нет в ответе
    const missing = top.filter(m => !m.post).map(m => m.postId);
    if (missing.length) {
        const posts = await client.postsByIds(missing).catch(() => []);
        const byId = new Map(posts.map(p => [p.id, p]));
        for (const m of top) m.post ??= byId.get(m.postId) ?? null;
    }
    return top.filter(m => m.post);
}
