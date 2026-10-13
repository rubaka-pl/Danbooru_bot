// Vercel: один автопост в канал. Дёргается внешним cron (например cron-job.org).
// Авторизация: заголовок "Authorization: Bearer <CRON_SECRET>" или ?secret=<CRON_SECRET>
// ?channel=18 — автопост в 18+ канал (ADULT_GROUP_ID) вместо основного.
import { createApp } from '../src/app.js';
import { adultAutopostDeps, autopostOnce } from '../src/services/autopost.js';

let app;

export default async function handler(req, res) {
    app ??= createApp({ serverless: true });
    const { config, bot } = app;
    const secret = config.autopost.cronSecret;

    const given = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query?.secret;
    if (!secret || given !== secret) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const adult = req.query?.channel === '18';
    if (!config.autopost.enabled || (adult && !(config.adult.enabled && config.adult.channelId))) {
        return res.status(200).json({ ok: true, result: 'disabled' });
    }

    const deps = adult ? adultAutopostDeps({ ...app, telegram: bot.telegram }) : { ...app, telegram: bot.telegram };
    const { alertKey = 'autopost', label = 'Автопост' } = deps;
    try {
        const result = await autopostOnce(deps);
        await app.alerts.success(alertKey, { label });
        res.status(200).json({ ok: true, result });
    } catch (error) {
        console.error(`❌ ${label}:`, error);
        await app.alerts.failure(alertKey, error, { label });
        res.status(500).json({ ok: false, error: error.message });
    }
}
