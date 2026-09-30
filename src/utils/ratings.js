// Рейтинги Danbooru: g — general, s — sensitive, q — questionable, e — explicit.
export const RATINGS = {
    general: { code: 'g', label: '🟢 Safe' },
    sensitive: { code: 's', label: '🟡 Sensitive' },
    explicit: { code: 'e', label: '🔴 18+' },
    any: { code: null, label: '🎲 Любой' }
};

export const DEFAULT_RATING = 'general';

export function ratingLabel(rating) {
    return RATINGS[rating]?.label ?? RATINGS[DEFAULT_RATING].label;
}

// Слова, которые пользователь может написать вместо тегов, чтобы выбрать рейтинг.
export const RATING_KEYWORDS = {
    'nsfw': 'explicit',
    '18+': 'explicit',
    'r18': 'explicit',
    'r-18': 'explicit',
    'explicit': 'explicit',
    'hentai': 'explicit',
    'sfw': 'general',
    'safe': 'general',
    'general': 'general',
    'sensitive': 'sensitive',
    'any': 'any',
    'all': 'any'
};

// Значения метатега rating:xxx
const RATING_META = {
    g: 'general', general: 'general', safe: 'general',
    s: 'sensitive', sensitive: 'sensitive',
    q: 'explicit', questionable: 'explicit',
    e: 'explicit', explicit: 'explicit'
};

export function ratingFromMeta(value) {
    return RATING_META[value?.toLowerCase()] ?? null;
}

// Теги, при которых по умолчанию включается 18+ режим.
export const NSFW_TAGS = [
    'anal', 'anal_fluid', 'anal_object_insertion', 'anilingus', 'ahegao', 'anus', 'bdsm', 'bondage',
    'bukkake', 'butt_plug', 'chastity_cage', 'clitoris', 'cooperative_fellatio', 'cowgirl_position',
    'creampie', 'cum', 'cum_in_ass', 'cunnilingus', 'deepthroat', 'dildo', 'doggystyle',
    'double_penetration', 'ejaculation', 'erection', 'exhibitionism', 'facial', 'fellatio', 'fingering',
    'footjob', 'futanari', 'gangbang', 'gaping', 'group_sex', 'guro', 'handjob', 'huge_penis',
    'implied_sex', 'masturbation', 'missionary', 'mmf_threesome', 'netorare', 'nipples', 'nude',
    'orgasm', 'orgy', 'paizuri', 'penis', 'pussy', 'pussy_juice', 'rape', 'reverse_cowgirl_position',
    'rimjob', 'sex', 'sex_toy', 'testicles', 'threesome', 'urethral_insertion', 'vaginal', 'vore'
];

const NSFW_SET = new Set(NSFW_TAGS);

export function isNsfwTag(tag) {
    return NSFW_SET.has(tag);
}

/** Рейтинг поста (g/s/q/e) → ключ RATINGS */
export function ratingFromCode(code) {
    return { g: 'general', s: 'sensitive', q: 'explicit', e: 'explicit' }[code] ?? DEFAULT_RATING;
}
