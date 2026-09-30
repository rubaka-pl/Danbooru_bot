![image](https://github.com/user-attachments/assets/8040d132-7573-4457-9d40-47780f394b3e)

# 🎨 Danbooru Telegram Bot

👉 [@OBITEL_DIONISA](https://t.me/OBITEL_DIONISA) · [@Danbooru_pictures_bot](https://t.me/Danbooru_pictures_bot)

Бот ищет арты на [Danbooru](https://danbooru.donmai.us) по запросу пользователя и автоматически постит картинки в канал.

## ✨ Возможности

- 🔎 **Понимает обычный текст**: `hatsune miku`, `naruto uzumaki` (порядок слов неважен), `мику` (транслит), алиасы (`boobs` → `breasts`), опечатки через автодополнение Danbooru
- 🏷 **Несколько тегов** через запятую: `rem, maid, smile`; исключение: `miku, -male_focus`
- 📋 **Список персонажей** — каждая строка отдельный поиск
- 🔞 **Рейтинг кнопками** (Safe / Sensitive / 18+ / Любой) или словом в запросе: `rem nsfw`
- 🧮 **Обход лимита Danbooru** (2 тега для анонимов): лишние теги бот фильтрует сам
- 🔁 Кнопка «ещё» после выдачи, без повторов уже показанных картинок
- 🎲 `/random`, 🔥 `/top` (популярное за день/неделю/месяц)
- 📨 GIF и MP4 тоже отправляются; подписи с автором, персонажем, тайтлом, тегами и ссылкой на пост
- 📡 **Автопост в канал** без повторов, с **тихими часами 23:30–06:00**
- ☁️ Два режима запуска: постоянный сервер (Render/VPS) или **serverless на Vercel** (бот «спит», пока нет сообщений)

## 🗂 Структура

```
api/                    — функции Vercel
  webhook.js            — приём обновлений от Telegram
  autopost.js           — один автопост (дёргается cron-ом)
scripts/setWebhook.js   — установка/удаление webhook
src/
  index.js              — запуск в режиме polling (Render, VPS, локально)
  app.js                — сборка зависимостей
  config.js             — настройки из переменных окружения
  bot/
    createBot.js
    request.js          — формат запроса в сообщении и клавиатуры
    chatState.js        — «занят»/уже показанное для каждого чата
    handlers/start.js   — /start, /help, /tags
    handlers/search.js  — поиск, кнопки, /random, /top
  services/
    danbooru.js         — клиент API Danbooru
    tagResolver.js      — «текст пользователя» → теги Danbooru
    postSearch.js       — поиск постов с учётом лимита тегов
    sender.js           — отправка в Telegram (с запасной загрузкой файлом)
    autopost.js         — автопост в канал + тихие часы
    history.js          — история отправленного (файл / Redis / память)
  utils/                — разбор запроса, подписи, рейтинги, транслит, время
test/                   — тесты (npm test)
```

## 🚀 Запуск

```bash
npm install
cp .env.example .env   # заполни BOT_TOKEN
node --env-file=.env src/index.js
npm test
```

### Render / VPS (polling)

Start command: `npm start` (или старая `node main.js` — тоже работает).
Бот работает постоянно, автопост идёт по таймеру `AUTOPOST_INTERVAL`.

### Vercel (serverless, экономит лимиты)

1. Импортируй репозиторий в Vercel. Никаких настроек сборки не нужно.
2. Storage → подключи **Upstash Redis** (бесплатно). Переменные `KV_REST_API_*` / `UPSTASH_REDIS_REST_*` подхватятся сами. Без Redis автопост может повторять картинки.
3. Добавь переменные: `BOT_TOKEN`, `GROUP_ID`, `WEBHOOK_SECRET`, `CRON_SECRET`.
4. Установи webhook (один раз, локально):
   ```bash
   BOT_TOKEN=... WEBHOOK_URL=https://<проект>.vercel.app/api/webhook WEBHOOK_SECRET=... npm run webhook:set
   ```
5. Автопост: на бесплатном тарифе Vercel cron запускается только раз в день, поэтому используй бесплатный [cron-job.org](https://cron-job.org):
   URL `https://<проект>.vercel.app/api/autopost?secret=<CRON_SECRET>`, интервал — например каждые 5–10 минут.
   В тихие часы эндпоинт сразу отвечает `quiet` и ничего не публикует.

> ⚠️ Одновременно работать может только один режим: webhook (Vercel) **или** polling (Render). Чтобы вернуться на polling — `npm run webhook:delete`.

## ⚙️ Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `BOT_TOKEN` | — | токен бота (обязательно) |
| `GROUP_ID` | `@Obitel_Dionisa` | канал для автопоста |
| `AUTOPOST` | `on` | `off` — выключить автопост |
| `AUTOPOST_INTERVAL` | `60` | интервал автопоста в секундах (polling) |
| `QUIET_HOURS` | `23:30-06:00` | тихие часы автопоста, `off` — выключить |
| `TZ_NAME` | `Europe/Warsaw` | часовой пояс для тихих часов |
| `DANBOORU_LOGIN`, `DANBOORU_API_KEY` | — | аккаунт Danbooru (необязательно) |
| `DANBOORU_TAG_LIMIT` | `2` | лимит тегов в одном запросе к API |
| `WEBHOOK_SECRET` | — | секрет webhook (Vercel) |
| `CRON_SECRET` | — | секрет для `/api/autopost` |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | — | Redis для истории на Vercel |
| `HISTORY_FILE` | `./data/sent_images.json` | файл истории (polling) |

---

## 🇵🇱 Opis

Bot Telegram, który wyszukuje ilustracje na Danbooru według zapytań użytkownika (postacie, anime, tagi) i automatycznie publikuje obrazki w kanale — z przerwą nocną 23:30–06:00. Działa na Render (polling) lub na Vercel (webhook, serverless).

## 🇬🇧 Description

A Telegram bot that searches Danbooru for illustrations by user query (characters, titles, tags, multiple tags, exclusions, rating selection) and auto-posts images to a channel with quiet hours (23:30–06:00). Runs either as a long-polling service (Render/VPS) or serverless on Vercel (webhook).

![image](https://github.com/user-attachments/assets/4ed1db69-fc56-47b4-a38f-ba42e786cc43)
![image](https://github.com/user-attachments/assets/4e00eef9-bbea-435c-abfd-cf67ef80ea78)
