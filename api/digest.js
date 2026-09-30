// Vercel: рассылка по подпискам. Дёргай внешним cron раз в час —
// рассылка уйдёт один раз в день после DIGEST_HOUR.
// Авторизация: "Authorization: Bearer <CRON_SECRET>" или ?secret=<CRON_SECRET>
import { createApp } from '../src/app.js';
import { runDigestIfDue } from '../src/services/subscriptions.js';

let app;

export default async function handler(req, res) {
    app ??= createApp({ serverless: true });
    const secret = app.config.autopost.cronSecret;
    const given = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query?.secret;
    if (!secret || given !== secret) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    try {
        const result = await runDigestIfDue({ ...app, telegram: app.bot.telegram }, { force: req.query?.force === '1' });
        res.status(200).json({ ok: true, ...result });
    } catch (error) {
        console.error('❌ Рассылка:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
}
