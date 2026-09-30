// Vercel: один автопост в канал. Дёргается внешним cron (например cron-job.org).
// Авторизация: заголовок "Authorization: Bearer <CRON_SECRET>" или ?secret=<CRON_SECRET>
import { createApp } from '../src/app.js';
import { autopostOnce } from '../src/services/autopost.js';

let app;

export default async function handler(req, res) {
    app ??= createApp({ serverless: true });
    const { config, bot } = app;
    const secret = config.autopost.cronSecret;

    const given = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query?.secret;
    if (!secret || given !== secret) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    if (!config.autopost.enabled) {
        return res.status(200).json({ ok: true, result: 'disabled' });
    }

    try {
        const result = await autopostOnce({ ...app, telegram: bot.telegram });
        await app.alerts.success('autopost', { label: 'Автопост' });
        res.status(200).json({ ok: true, result });
    } catch (error) {
        console.error('❌ Автопост:', error);
        await app.alerts.failure('autopost', error, { label: 'Автопост' });
        res.status(500).json({ ok: false, error: error.message });
    }
}
