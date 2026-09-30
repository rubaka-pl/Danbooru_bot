import { RATING_KEYWORDS, ratingFromMeta } from './ratings.js';

// Метатеги Danbooru, которые передаются в API как есть (без поиска тега).
const METATAGS = new Set([
    'score', 'favcount', 'date', 'age', 'order', 'id', 'width', 'height', 'mpixels', 'ratio',
    'filetype', 'filesize', 'is', 'has', 'status', 'user', 'fav', 'pool', 'source', 'tagcount',
    'gentags', 'arttags', 'chartags', 'copytags', 'parent', 'child'
]);

export function isMetatag(tag) {
    const match = tag.match(/^([a-z_]+):(.+)$/);
    return Boolean(match && METATAGS.has(match[1]));
}

/**
 * Нормализует тег так, как его хранит Danbooru: нижний регистр, пробелы → "_".
 */
export function normalizeTag(value) {
    return value
        .trim()
        .replace(/^#+/, '')
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_');
}

function parseTerm(raw) {
    let text = raw.trim();
    if (!text) return null;

    const lower = text.toLowerCase();
    if (RATING_KEYWORDS[lower]) return { kind: 'rating', rating: RATING_KEYWORDS[lower] };

    let negated = false;
    if (text.startsWith('-') && text.length > 1) {
        negated = true;
        text = text.slice(1);
    }

    const tag = normalizeTag(text);
    if (!tag) return null;

    const meta = tag.match(/^([a-z_]+):(.+)$/);
    if (meta) {
        if (meta[1] === 'rating' && !negated) {
            const rating = ratingFromMeta(meta[2]);
            if (rating) return { kind: 'rating', rating };
        }
        if (isMetatag(tag)) return { kind: 'meta', raw: text, tag, negated };
    }

    return { kind: 'tag', raw: text, tag, negated };
}

function splitLine(line) {
    // Скопированные из подписи хэштеги: "#hatsune_miku #vocaloid"
    if (/(^|\s)#\S/.test(line)) {
        return line.split(/[\s,;]+/).filter(Boolean);
    }
    // Иначе разделители — запятая, точка с запятой или " + "
    return line.split(/\s*[,;]\s*|\s+\+\s+/).filter(Boolean);
}

/**
 * Разбирает сообщение пользователя.
 * Каждая строка — отдельный поиск, теги внутри строки разделяются запятыми.
 *
 * @returns {{ groups: Array<{ label: string, terms: Array<object> }>, rating: string|null }}
 */
export function parseUserInput(text, { maxGroups = 10, maxTerms = 6 } = {}) {
    let rating = null;
    const groups = [];

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
        const terms = [];
        for (const part of splitLine(line)) {
            // "rem nsfw" → тег "rem" + рейтинг 18+
            const words = part.split(/\s+/);
            const kept = words.filter(word => {
                const keywordRating = RATING_KEYWORDS[word.toLowerCase()];
                if (keywordRating && words.length > 1) rating = keywordRating;
                return !(keywordRating && words.length > 1);
            });
            const term = parseTerm(kept.join(' '));
            if (!term) continue;
            if (term.kind === 'rating') {
                rating = term.rating;
                continue;
            }
            if (!terms.some(t => t.tag === term.tag && t.negated === term.negated)) {
                terms.push(term);
            }
        }
        if (terms.length) groups.push({ label: line, terms: terms.slice(0, maxTerms) });
    }

    return { groups: groups.slice(0, maxGroups), rating };
}
