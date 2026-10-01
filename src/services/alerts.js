/*
 * Уведомления админам (ADMIN_IDS) о сбоях: чтобы бот мог работать годами без присмотра,
 * а владелец узнавал о проблемах сразу. Одинаковые уведомления не чаще раза в 30 минут.
 */

const THROTTLE_MS = 30 * 60 * 1000;

export function createAlerts({ getTelegram, config, now = () => Date.now() }) {
    const lastSent = new Map();
    const failures = new Map();

    async function notify(key, text, { force = false, icon = '🚨' } = {}) {
        if (!config.adminIds.length) return false;
        if (!force && lastSent.has(key) && now() - lastSent.get(key) < THROTTLE_MS) return false;
        lastSent.set(key, now());
        const telegram = getTelegram();
        await Promise.all(config.adminIds.map(id =>
            telegram.sendMessage(id, `${icon} ${text}`).catch(error => console.error('⚠️ Не удалось уведомить админа:', error.message))
        ));
        return true;
    }

    return {
        notify,

        /**
         * Считает подряд идущие сбои. После `threshold` сбоев — уведомление,
         * после восстановления — сообщение «всё снова работает».
         */
        async failure(key, error, { threshold = 3, label = key } = {}) {
            const count = (failures.get(key) ?? 0) + 1;
            failures.set(key, count);
            if (count === threshold) {
                await notify(key, `${label}: ${count} ошибок подряд.\nПоследняя: ${error?.message ?? error}`);
            }
            return count;
        },

        async success(key, { label = key } = {}) {
            const count = failures.get(key) ?? 0;
            failures.set(key, 0);
            if (count >= 3) await notify(`${key}:ok`, `${label}: снова работает (после ${count} ошибок).`, { force: true, icon: '✅' });
        },

        failures: (key) => failures.get(key) ?? 0
    };
}
