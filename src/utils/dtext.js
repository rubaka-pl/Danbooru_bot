/**
 * Превращает DText (разметку вики Danbooru) в короткий простой текст.
 */
export function dtextToPlain(text, maxLength = 700) {
    if (!text) return '';
    let plain = String(text)
        .replace(/\[expand[^\]]*\][\s\S]*?\[\/expand\]/gi, '')      // скрытые блоки
        .replace(/\[table\][\s\S]*?\[\/table\]/gi, '')               // таблицы
        .replace(/^h\d\.\s*.*$/gim, '')                              // заголовки
        .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')               // [[tag|текст]]
        .replace(/\[\[([^\]]+)\]\]/g, (_, t) => t.replace(/_/g, ' ')) // [[tag]]
        .replace(/\{\{([^}]+)\}\}/g, '$1')                           // {{search}}
        .replace(/"([^"]+)":\S+/g, '$1')                             // "текст":ссылка
        .replace(/<([^>]+)>/g, '$1')
        .replace(/\[\/?[a-z]+(=[^\]]*)?\]/gi, '')                    // [b], [i], [url=..]
        .replace(/^\s*\*+\s*/gm, '• ')
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    if (plain.length > maxLength) {
        const cut = plain.slice(0, maxLength);
        const lastBreak = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
        plain = `${(lastBreak > maxLength / 2 ? cut.slice(0, lastBreak + 1) : cut).trim()}…`;
    }
    return plain;
}
