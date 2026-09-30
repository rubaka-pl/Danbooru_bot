// Vercel: Telegram присылает сюда обновления (webhook). Функция спит, пока нет сообщений.
import { waitUntil } from '@vercel/functions';
import { createApp } from '../src/app.js';

let app;
const getApp = () => (app ??= createApp({
    serverless: true,
    // Отправка картинок продолжается после ответа Telegram
    runTask: (promise) => waitUntil(promise.catch(error => console.error('❌ Фоновая задача:', error)))
}));

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).send('Bot webhook is alive.');
    }

    const { bot, config } = getApp();
    if (config.webhookSecret && req.headers['x-telegram-bot-api-secret-token'] !== config.webhookSecret) {
        return res.status(401).send('Unauthorized');
    }

    try {
        await bot.handleUpdate(req.body);
    } catch (error) {
        console.error('❌ Ошибка обработки обновления:', error);
    }
    // Всегда 200, иначе Telegram будет слать то же обновление снова
    res.status(200).send('ok');
}
