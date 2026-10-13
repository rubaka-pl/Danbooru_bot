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
    'after_sex', 'ahegao', 'anal', 'anal_beads', 'anal_fluid', 'anal_object_insertion', 'anilingus', 'anus',
    'armpit_sex', 'bar_censor', 'bdsm', 'bondage', 'breast_sucking', 'bukkake', 'butt_plug', 'buttjob',
    'chastity_cage', 'clitoris', 'clothed_female_nude_male', 'clothed_sex', 'completely_nude',
    'cooperative_fellatio', 'cowgirl_position', 'creampie', 'cum', 'cum_in_ass', 'cum_in_mouth',
    'cum_in_pussy', 'cum_on_body', 'cum_on_breasts', 'cum_on_hair', 'cum_pool', 'cumdrip', 'cunnilingus',
    'deepthroat', 'dildo', 'doggystyle', 'double_penetration', 'egg_vibrator', 'ejaculation', 'erection',
    'exhibitionism', 'facial', 'fellatio', 'female_ejaculation', 'female_masturbation', 'female_pubic_hair',
    'fingering', 'footjob', 'fucked_silly', 'full_nelson', 'futanari', 'gangbang', 'gaping', 'grinding',
    'group_sex', 'guro', 'handjob', 'huge_penis', 'implied_sex', 'impregnation', 'irrumatio', 'lactation',
    'licking_penis', 'male_masturbation', 'male_pubic_hair', 'masturbation', 'mating_press', 'missionary',
    'mmf_threesome', 'mosaic_censoring', 'mutual_masturbation', 'netorare', 'nipple_tweak', 'nipples',
    'nude', 'object_insertion', 'oral', 'orgasm', 'orgy', 'paizuri', 'paizuri_under_clothes', 'penetration',
    'penis', 'prone_bone', 'pubic_hair', 'pussy', 'pussy_juice', 'pussy_juice_trail', 'rape',
    'reverse_cowgirl_position', 'rimjob', 'sex', 'sex_from_behind', 'sex_machine', 'sex_toy', 'spread_anus',
    'spread_pussy', 'squirting', 'standing_sex', 'stomach_bulge', 'strap-on', 'suspended_congress',
    'tentacle_sex', 'testicles', 'thigh_sex', 'threesome', 'tribadism', 'uncensored', 'urethral_insertion',
    'vaginal', 'vaginal_object_insertion', 'vibrator', 'vore', 'x-ray'
];

const NSFW_SET = new Set(NSFW_TAGS);

export function isNsfwTag(tag) {
    return NSFW_SET.has(tag);
}

/** Рейтинг поста (g/s/q/e) → ключ RATINGS */
export function ratingFromCode(code) {
    return { g: 'general', s: 'sensitive', q: 'explicit', e: 'explicit' }[code] ?? DEFAULT_RATING;
}

/**
 * Безопасный режим: 18+ и «любой» превращаются в safe.
 * @returns {{ rating: string, changed: boolean }}
 */
export function enforceSafe(rating, safe) {
    if (safe && (rating === 'explicit' || rating === 'any')) return { rating: 'general', changed: true };
    return { rating, changed: false };
}

/** Пост с рейтингом questionable или explicit */
export const isAdult = (post) => post.rating === 'q' || post.rating === 'e';
