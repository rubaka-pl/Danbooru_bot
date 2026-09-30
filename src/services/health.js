/*
 * Состояние бота для /health. Хостинг (Render) может сам перезапускать сервис,
 * если /health отвечает 503, — так бот «лечится» без участия человека.
 */

export function createHealth({ now = () => Date.now() } = {}) {
    const startedAt = now();
    const state = {
        lastAutopostAt: null,      // последний успешный пост
        lastAutopostResult: null,
        autopostFailures: 0,
        lastUpdateAt: null         // последнее обработанное обновление от Telegram
    };

    return {
        state,

        markAutopost(result) {
            state.lastAutopostResult = result;
            state.autopostFailures = 0;
            if (result === 'posted' || result === 'album' || result === 'battle') state.lastAutopostAt = now();
        },

        markAutopostError() {
            state.autopostFailures++;
        },

        markUpdate() {
            state.lastUpdateAt = now();
        },

        /**
         * @returns {{ ok: boolean, reason?: string, ... }}
         */
        snapshot({ autopostEnabled = true, maxSilenceMs = 3 * 60 * 60 * 1000 } = {}) {
            const uptimeSec = Math.round((now() - startedAt) / 1000);
            const base = { uptimeSec, ...state };
            if (state.autopostFailures >= 20) return { ok: false, reason: 'autopost keeps failing', ...base };
            // Долгая тишина при включённом автопосте (тихие часы и пауза — не тишина)
            const idleResults = ['quiet', 'paused'];
            const reference = state.lastAutopostAt ?? startedAt;
            if (autopostEnabled && !idleResults.includes(state.lastAutopostResult) && now() - reference > maxSilenceMs) {
                return { ok: false, reason: 'no autoposts for too long', ...base };
            }
            return { ok: true, ...base };
        }
    };
}
