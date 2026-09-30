export const CAPTION_LIMIT = 1024;

export function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Хэштег Telegram может содержать только буквы, цифры и "_".
 * "saber_(fate)" → "#saber_fate", ":d" → "#d".
 */
export function toHashtag(tag) {
    const clean = String(tag)
        .replace(/[^\p{L}\p{N}_]+/gu, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    if (!clean || /^\d+$/.test(clean)) return null;
    return `#${clean}`;
}

/** "hatsune_miku" → "Hatsune Miku" */
export function humanizeTag(tag) {
    return String(tag)
        .replace(/_/g, ' ')
        .replace(/(^|[\s(])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

const splitTags = (value) => (value || '').split(' ').filter(Boolean);

function namedLine(icon, title, tags, max) {
    if (!tags.length) return null;
    const items = tags.slice(0, max).map(tag => {
        const hashtag = toHashtag(tag);
        return `${escapeHtml(humanizeTag(tag))}${hashtag ? ` ${hashtag}` : ''}`;
    });
    const more = tags.length > max ? ` и ещё ${tags.length - max}` : '';
    return `${icon} ${title}: ${items.join(', ')}${more}`;
}

/**
 * Подпись к картинке. Гарантированно укладывается в лимит Telegram (1024 символа).
 * Разметка — HTML.
 */
export function buildCaption(post, { postUrl, query, maxGeneralTags = 25 } = {}) {
    const lines = [
        query && `🔎 Запрос: ${escapeHtml(query)}`,
        namedLine('🎨', 'Автор', splitTags(post.tag_string_artist), 3),
        namedLine('👤', 'Персонаж', splitTags(post.tag_string_character), 4),
        namedLine('📺', 'Тайтл', splitTags(post.tag_string_copyright), 2),
        post.created_at && `📅 Дата: ${post.created_at.split('T')[0]}`
    ].filter(Boolean);

    const footer = postUrl ? `🔗 <a href="${escapeHtml(postUrl)}">Открыть на Danbooru</a>` : '';

    // Общие теги добавляем, пока влезают в лимит
    const general = splitTags(post.tag_string_general)
        .map(toHashtag)
        .filter(Boolean)
        .slice(0, maxGeneralTags);

    const visibleLength = (text) => text.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt);/g, '_').length;
    const base = [...lines, footer].filter(Boolean).join('\n');
    let tagsLine = '';
    for (const tag of general) {
        const next = tagsLine ? `${tagsLine} ${tag}` : `🏷 Теги: ${tag}`;
        if (visibleLength(base) + next.length + 1 > CAPTION_LIMIT) break;
        tagsLine = next;
    }

    let caption = [...lines, tagsLine, footer].filter(Boolean).join('\n');
    // Страховка на случай очень длинных имён
    while (visibleLength(caption) > CAPTION_LIMIT && lines.length) {
        lines.pop();
        caption = [...lines, tagsLine, footer].filter(Boolean).join('\n');
    }
    return caption;
}

export function formatCount(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(n);
}
