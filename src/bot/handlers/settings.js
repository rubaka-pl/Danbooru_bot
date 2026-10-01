import { Markup } from 'telegraf';
import { RATINGS, ratingLabel } from '../../utils/ratings.js';
import { HIDE_PRESETS } from '../../services/userData.js';

const onOff = (value) => (value ? '✅ вкл' : '⬜ выкл');

function hideRows(hidden) {
    const buttons = Object.entries(HIDE_PRESETS).map(([key, preset]) =>
        Markup.button.callback(`${hidden.includes(key) ? '🚫' : '👁'} ${preset.label}`, `set:hide:${key}`));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    return rows;
}

export function settingsView(settings, counts) {
    const text = [
        '⚙️ <b>Настройки</b>',
        '',
        `Рейтинг по умолчанию: ${ratingLabel(settings.rating)}`,
        `Картинок за раз (быстрый режим, 💡 и ✨): ${settings.count}`,
        `⚡ Быстрый режим — искать сразу, без вопроса «сколько»: ${onOff(settings.quick)}`,
        `🔒 Безопасный режим — никогда не показывать 18+: ${onOff(settings.safe)}`,
        `🚫 Скрывать: ${(settings.hide ?? []).map(k => HIDE_PRESETS[k]?.label).filter(Boolean).join(', ') || 'ничего'}`,
        '',
        'Свои теги скрыть: <code>/block тег</code>'
    ].join('\n');

    const ratingRow = Object.keys(RATINGS).map(key =>
        Markup.button.callback(`${key === settings.rating ? '✅ ' : ''}${RATINGS[key].label}`, `set:rating:${key}`));
    const countRow = counts.map(n => Markup.button.callback(`${n === settings.count ? '✅ ' : ''}${n}`, `set:count:${n}`));

    return {
        text,
        extra: {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                ratingRow.slice(0, 2),
                ratingRow.slice(2),
                countRow,
                [Markup.button.callback(`⚡ Быстрый: ${settings.quick ? 'вкл' : 'выкл'}`, 'set:quick')],
                [Markup.button.callback(`🔒 Безопасный: ${settings.safe ? 'вкл' : 'выкл'}`, 'set:safe')],
                ...hideRows(settings.hide ?? [])
            ])
        }
    };
}

/**
 * /settings — рейтинг и количество по умолчанию, быстрый и безопасный режимы.
 */
export function registerSettings(bot, { userData, config }) {
    const { counts } = config.search;

    bot.command('settings', async (ctx) => {
        const { text, extra } = settingsView(await userData.settings.get(ctx.chat.id), counts);
        await ctx.reply(text, extra);
    });

    bot.action(/^set:(rating|count|quick|safe|hide)(?::(\w+))?$/, async (ctx) => {
        const [, field, value] = ctx.match;
        const current = await userData.settings.get(ctx.chat.id);
        let patch;
        if (field === 'rating' && RATINGS[value]) patch = { rating: value };
        else if (field === 'count' && counts.includes(Number(value))) patch = { count: Number(value) };
        else if (field === 'quick') patch = { quick: !current.quick };
        else if (field === 'safe') patch = { safe: !current.safe };
        else if (field === 'hide' && HIDE_PRESETS[value]) {
            const hide = current.hide ?? [];
            patch = { hide: hide.includes(value) ? hide.filter(k => k !== value) : [...hide, value] };
        }
        if (!patch) return ctx.answerCbQuery();

        const next = await userData.settings.update(ctx.chat.id, patch);
        await ctx.answerCbQuery('✅ Сохранено');
        const { text, extra } = settingsView(next, counts);
        await ctx.editMessageText(text, extra).catch(() => {});
    });
}
