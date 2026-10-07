import { Markup } from 'telegraf';
import { RATINGS, ratingLabel } from '../../utils/ratings.js';
import { HIDE_PRESETS } from '../../services/userData.js';
import { chunk } from '../request.js';

const onOff = (value) => (value ? '✅ вкл' : '⬜ выкл');

function hideRows(hidden) {
    const buttons = Object.entries(HIDE_PRESETS).map(([key, preset]) =>
        Markup.button.callback(`${hidden.includes(key) ? '🚫' : '👁'} ${preset.label}`, `set:hide:${key}`));
    return chunk(buttons, 2);
}

/**
 * @param {Object<string, {name: string}>} [sources] — доступные борды (id → клиент)
 */
export function settingsView(settings, counts, boorus = {}) {
    const sources = { danbooru: { name: 'Danbooru' }, ...boorus };
    const sourceIds = Object.keys(sources);
    const sourceName = sources[settings.source]?.name ?? 'Danbooru';
    const text = [
        '⚙️ <b>Настройки</b>',
        '',
        ...(sourceIds.length > 1 ? [`🌐 Источник: <b>${sourceName}</b> (подсказки, ❤️ и «похожие» — всегда с Danbooru)`] : []),
        `Рейтинг по умолчанию: ${ratingLabel(settings.rating)}`,
        `Картинок за раз (быстрый режим, 💡 и ✨): ${settings.count}`,
        `⚡ Быстрый режим — искать сразу, без вопроса «сколько»: ${onOff(settings.quick)}`,
        `🔒 Безопасный режим — никогда не показывать 18+: ${onOff(settings.safe)}`,
        `🗂 Альбомами — 10+ картинок пачками по 10, без спама уведомлениями: ${onOff(settings.albums)}`,
        `🚫 Скрывать: ${(settings.hide ?? []).map(k => HIDE_PRESETS[k]?.label).filter(Boolean).join(', ') || 'ничего'}`,
        '',
        'Свои теги скрыть: <code>/block тег</code>'
    ].join('\n');

    const ratingRow = Object.keys(RATINGS).map(key =>
        Markup.button.callback(`${key === settings.rating ? '✅ ' : ''}${RATINGS[key].label}`, `set:rating:${key}`));
    const countButtons = counts.map(n => Markup.button.callback(`${n === settings.count ? '✅ ' : ''}${n}`, `set:count:${n}`));

    return {
        text,
        extra: {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                ...chunk(sourceIds.map(id => Markup.button.callback(
                    `${sources[id].name === sourceName ? '✅ ' : ''}${sources[id].name}`, `set:source:${id}`)), 3),
                ratingRow.slice(0, 2),
                ratingRow.slice(2),
                ...chunk(countButtons, 3),
                [Markup.button.callback(`⚡ Быстрый: ${settings.quick ? 'вкл' : 'выкл'}`, 'set:quick')],
                [Markup.button.callback(`🔒 Безопасный: ${settings.safe ? 'вкл' : 'выкл'}`, 'set:safe')],
                [Markup.button.callback(`🗂 Альбомами: ${settings.albums ? 'вкл' : 'выкл'}`, 'set:albums')],
                ...hideRows(settings.hide ?? [])
            ])
        }
    };
}

/**
 * /settings — рейтинг и количество по умолчанию, быстрый и безопасный режимы.
 */
export function registerSettings(bot, { userData, config, boorus = {} }) {
    const { counts } = config.search;
    const view = (settings) => settingsView(settings, counts, boorus);

    bot.command('settings', async (ctx) => {
        const { text, extra } = view(await userData.settings.get(ctx.chat.id));
        await ctx.reply(text, extra);
    });

    bot.action(/^set:(rating|count|quick|safe|albums|source|hide)(?::(\w+))?$/, async (ctx) => {
        const [, field, value] = ctx.match;
        const current = await userData.settings.get(ctx.chat.id);
        let patch;
        if (field === 'rating' && RATINGS[value]) patch = { rating: value };
        else if (field === 'count' && counts.includes(Number(value))) patch = { count: Number(value) };
        else if (field === 'quick') patch = { quick: !current.quick };
        else if (field === 'safe') patch = { safe: !current.safe };
        else if (field === 'albums') patch = { albums: !current.albums };
        else if (field === 'source' && (value === 'danbooru' || boorus[value])) patch = { source: value };
        else if (field === 'hide' && HIDE_PRESETS[value]) {
            const hide = current.hide ?? [];
            patch = { hide: hide.includes(value) ? hide.filter(k => k !== value) : [...hide, value] };
        }
        if (!patch) return ctx.answerCbQuery();

        const next = await userData.settings.update(ctx.chat.id, patch);
        await ctx.answerCbQuery('✅ Сохранено');
        const { text, extra } = view(next);
        await ctx.editMessageText(text, extra).catch(() => {});
    });
}
