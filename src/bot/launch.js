const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Запуск long polling с понятной диагностикой и самовосстановлением.
 *
 * Частые причины, почему бот «не отвечает в личке»:
 *  - 409 Conflict — где-то запущена ещё одна копия бота с тем же токеном и забирает сообщения
 *    (при деплое на Render старая и новая копии ненадолго работают вместе);
 *  - на токене висит webhook (например, после Vercel) — тогда polling не получает сообщения.
 * Вместо падения ждём и пробуем снова, а админ получает уведомление.
 */
export async function launchPolling(bot, { allowedUpdates, alerts, onLaunch, retryMs = 30_000, log = console } = {}) {
    for (let attempt = 1; ; attempt++) {
        try {
            const info = await bot.telegram.getWebhookInfo().catch(() => null);
            if (info?.url) {
                log.warn(`⚠️ На боте установлен webhook (${info.url}) — удаляю и переключаюсь на polling`);
            }
            await bot.launch({ dropPendingUpdates: attempt === 1, allowedUpdates }, onLaunch);
            return; // polling остановлен штатно (bot.stop)
        } catch (error) {
            const code = error?.response?.error_code;
            if (code === 409) {
                log.error('❌ 409 Conflict: другая копия бота с этим токеном уже получает сообщения. '
                    + 'Останови старый бот (другой хостинг, компьютер, второй сервис Render). Пробую снова через '
                    + `${Math.round(retryMs / 1000)} сек.`);
                await alerts?.notify('conflict', 'Бот не получает сообщения: с этим же токеном запущена другая копия бота (409 Conflict). '
                    + 'Останови лишнюю копию — старый сервер, компьютер или второй сервис на хостинге.');
                await sleep(retryMs);
                continue;
            }
            if (code === 401 || code === 404) {
                log.error('❌ Неверный BOT_TOKEN — проверь переменную окружения на хостинге.');
            }
            throw error;
        }
    }
}

/** Одна строка в лог на каждое входящее обновление — видно, доходят ли сообщения. */
export function logUpdates(log = console) {
    return (ctx, next) => {
        const chat = ctx.chat ? `${ctx.chat.type} ${ctx.chat.id}` : `user ${ctx.from?.id ?? '?'}`;
        const text = ctx.message?.text;
        const detail = text
            ? (text.startsWith('/') ? text.split(/\s/)[0] : 'текст')
            : ctx.callbackQuery?.data ? `кнопка ${String(ctx.callbackQuery.data).split(':')[0]}` : '';
        log.log(`📩 ${ctx.updateType} (${chat})${detail ? ` ${detail}` : ''}`);
        return next();
    };
}
