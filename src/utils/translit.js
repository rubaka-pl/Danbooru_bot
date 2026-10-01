// Транслитерация кириллицы в латиницу в стиле ромадзи/английских названий,
// чтобы "Наруто" или "Мику" превращались в теги Danbooru.
const MAP = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g'
};

export function hasCyrillic(text) {
    return /[Ѐ-ӿ]/.test(text);
}

export function transliterate(text) {
    return [...text.toLowerCase()].map(ch => MAP[ch] ?? ch).join('');
}
