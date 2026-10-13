/*
 * Чистка профиля бота от чужой рекламы. Если токен утекал, взломщик мог поставить
 * своё описание («free telegram premium…»), в том числе отдельно для каждого языка —
 * такие версии в @BotFather не видны и не заменяются. При запуске бот проверяет
 * описание, короткое описание и имя на всех языках и убирает подозрительные.
 */

export const DEFAULT_DESCRIPTION = '🎨 Ищу арты на Danbooru по запросу.\n\n'
    + 'Напиши имя персонажа, тайтл или тег — например, hatsune miku или frieren. '
    + 'Можно несколько через запятую, можно по-русски.\n\n📡 Канал: @Obitel_Dionisa';
export const DEFAULT_SHORT_DESCRIPTION = 'Арты с Danbooru по запросу · канал @Obitel_Dionisa';

// ISO 639-1: Telegram хранит отдельные версии профиля по двухбуквенному коду языка
export const LANGUAGE_CODES = ('aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv '
    + 'cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id '
    + 'ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh '
    + 'mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa '
    + 'sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve '
    + 'vi vo wa wo xh yi yo za zh zu').split(' ');

const TRUSTED_HOSTS = ['t.me', 'telegram.me', 'danbooru.donmai.us', 'gelbooru.com', 'github.com'];
const SPAM_WORDS = /premium|gift|подар|free\s+telegram|airdrop|crypto|claim/i;

/** Ссылка на чужой сайт или типичные слова фишинга. */
export function isSuspicious(text) {
    if (!text) return false;
    if (SPAM_WORDS.test(text)) return true;
    const hosts = [...text.matchAll(/(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/|\b)/gi)].map(m => m[1].toLowerCase());
    return hosts.some(host => !TRUSTED_HOSTS.some(ok => host === ok || host.endsWith(`.${ok}`)));
}

const FIELDS = [
    { get: 'getMyDescription', set: 'setMyDescription', key: 'description', fallback: DEFAULT_DESCRIPTION },
    { get: 'getMyShortDescription', set: 'setMyShortDescription', key: 'short_description', fallback: DEFAULT_SHORT_DESCRIPTION },
    { get: 'getMyName', set: 'setMyName', key: 'name', fallback: null }
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Проверяет профиль на всех языках и чистит подозрительное: основное описание
 * заменяется своим, языковые версии удаляются (остаётся основная).
 * @returns {Promise<string[]>} что исправлено, например ['description', 'name:ru']
 */
export async function cleanBotProfile(telegram, { delayMs = 60, log = console } = {}) {
    const call = async (method, payload) => {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await telegram.callApi(method, payload);
            } catch (error) {
                const retry = error?.response?.parameters?.retry_after;
                if (!retry) throw error;
                await sleep(retry * 1000);
            }
        }
        return null;
    };

    const fixed = [];
    for (const language of [null, ...LANGUAGE_CODES]) {
        for (const field of FIELDS) {
            const payload = language ? { language_code: language } : {};
            const current = await call(field.get, payload).catch(() => null);
            if (isSuspicious(current?.[field.key])) {
                // Основная версия → своя; языковая → пустая (Telegram покажет основную)
                if (!language && !field.fallback) continue; // основное имя не трогаем
                const value = language ? '' : field.fallback;
                const ok = await call(field.set, { ...payload, [field.key]: value }).then(() => true, () => false);
                if (ok) fixed.push(language ? `${field.key}:${language}` : field.key);
            }
            if (delayMs) await sleep(delayMs);
        }
    }
    if (fixed.length) {
        log.warn(`🧹 Убрал чужую рекламу из профиля бота: ${fixed.join(', ')}`);
    } else {
        log.log('🧹 Профиль бота проверен — чужой рекламы нет');
    }
    return fixed;
}
