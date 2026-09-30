// Переключает бота на webhook (Vercel):
//   BOT_TOKEN=... WEBHOOK_URL=https://<project>.vercel.app/api/webhook WEBHOOK_SECRET=... npm run webhook:set
// Вернуться на polling (Render/локально):  npm run webhook:delete
import { Telegram } from 'telegraf';
import { COMMANDS } from '../src/bot/handlers/start.js';

const { BOT_TOKEN, WEBHOOK_URL, WEBHOOK_SECRET } = process.env;
if (!BOT_TOKEN) {
    console.error('Нужен BOT_TOKEN');
    process.exit(1);
}

const telegram = new Telegram(BOT_TOKEN);

if (process.argv.includes('--delete')) {
    await telegram.deleteWebhook();
    console.log('✅ Webhook удалён — можно запускать npm start (polling)');
} else {
    if (!WEBHOOK_URL) {
        console.error('Нужен WEBHOOK_URL, например https://my-bot.vercel.app/api/webhook');
        process.exit(1);
    }
    await telegram.setWebhook(WEBHOOK_URL, {
        secret_token: WEBHOOK_SECRET || undefined,
        drop_pending_updates: true,
        allowed_updates: ['message', 'callback_query']
    });
    await telegram.setMyCommands(COMMANDS);
    console.log('✅ Webhook установлен:', WEBHOOK_URL);
    console.log(await telegram.getWebhookInfo());
}
