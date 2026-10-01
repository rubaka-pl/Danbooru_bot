// Проверка, что API Danbooru работает так, как ожидает бот.
// Запуск: npm run check:danbooru  (раз в неделю — автоматически в GitHub Actions)
import { createDanbooruClient } from '../src/services/danbooru.js';
import { formatContractReport, runContractChecks } from '../src/services/danbooruContract.js';

const client = createDanbooruClient({
    baseUrl: process.env.DANBOORU_URL || 'https://danbooru.donmai.us',
    login: process.env.DANBOORU_LOGIN,
    apiKey: process.env.DANBOORU_API_KEY,
    userAgent: 'DanbooruTelegramBot/2.0 contract-check (+https://github.com/rubaka-pl/Danbooru_bot)',
    timeout: 30000
});

const results = await runContractChecks(client);
console.log(formatContractReport(results));

const broken = results.filter(r => r.required && !r.ok);
if (broken.length) {
    console.error(`\n❌ Сломано проверок: ${broken.length}. Бот может работать неправильно — нужно обновить код.`);
    process.exit(1);
}
console.log('\n✅ API Danbooru в порядке');
