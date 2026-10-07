![image](https://github.com/user-attachments/assets/8040d132-7573-4457-9d40-47780f394b3e)

# 🎨 Danbooru Telegram Bot

👉 [@OBITEL_DIONISA](https://t.me/OBITEL_DIONISA) · [@Danbooru_pictures_bot](https://t.me/Danbooru_pictures_bot)

Бот ищет арты на [Danbooru](https://danbooru.donmai.us) по запросу пользователя и автоматически постит картинки в канал.

> 📋 **Как запустить — пошагово: [docs/SETUP.md](docs/SETUP.md)**

## ✨ Возможности

**Поиск**
- 🔎 **Понимает обычный текст**: `hatsune miku`, `naruto uzumaki` (порядок слов неважен), `мику` (транслит), алиасы (`boobs` → `breasts`), опечатки через автодополнение Danbooru
- 🏷 **Несколько тегов** через запятую: `rem, maid, smile`; исключение: `miku, -male_focus`
- 📋 **Список персонажей** — каждая строка отдельный поиск
- 🔞 **Рейтинг кнопками** (Safe / Sensitive / 18+ / Любой) или словом в запросе: `rem nsfw`
- 🧮 **Обход лимита Danbooru** (2 тега для анонимов): лишние теги бот фильтрует сам
- 🎲 `/random`, 🔥 `/top` (популярное за день/неделю/месяц)

- 💡 **Опечатки**: `hatsue miku` → «Возможно, ты имел в виду hatsune_miku?»
- ⚙️ `/settings`: рейтинг и количество по умолчанию, ⚡ быстрый режим (без вопроса «сколько»), 🔒 безопасный режим (никогда 18+), 🗂 альбомы, 🚫 быстрые фильтры «скрывать яой / юри / футанари / фурри / гуро»
- 📥 **1–30 картинок за раз**; 10+ приходят альбомами по 10 (можно выключить в `/settings`), уведомление — только от первой, остальные тихо
- 🏷 **Теги в подписи кликабельны**: клик переключает ленту на этот тег прямо в боте (а не глобальный поиск хэштега в Telegram); «🔀 Смешать» добавляет тег к прошлому запросу (`miku` → клик по `maid` → `miku + maid`)

**Под каждой картинкой**
- ❤️ в избранное (`/favs` — альбомами по 10, с удалением)
- 🖼 **View original** — картинка в полном разрешении в браузере; 📥 файлом без сжатия
- 🔍 похожие (IQDB), 🎨 ещё этого автора, 👤 ещё этого персонажа, 📤 поделиться с другом (через inline)
- Картинки отправляются **в оригинальном качестве**, когда Telegram это позволяет (до 5 МБ), иначе — уменьшенной копией

**Остальное**
- 📷 **Поиск по картинке**: пришли скрин — бот найдёт пост, автора, теги и ссылку на оригинал
- 💬 **Inline-режим**: `@бот miku` в любом чате — сетка картинок с подгрузкой
- 🔔 **Подписки**: `/sub hatsune miku` — раз в день присылает новые арты (альбомом); кнопка 🔔 после поиска
- 🚫 **Блок-лист**: `/block yaoi, guro` — эти теги никогда не покажутся (поиск, inline, подписки)
- ✨ `/foryou` — подборка по твоему вкусу (по избранному)
- ℹ️ `/info frieren` — кто это: описание из вики, другие названия, число артов, связанные теги-кнопки
- 🎮 `/quiz` — «Угадай персонажа» (работает и в группах), `/quiztop` — таблица лидеров с сериями
- 🖼 `/wallpaper phone frieren` — обои для телефона/ПК в оригинальном качестве
- 👤 `/me` — профиль, 🕘 `/history` — повтор последних запросов

**Канал**
- 📡 Автопост без повторов, с **тихими часами 23:30–06:00**
- 🗂 Иногда (≈ каждый 8-й) — **альбом из 5–10 картинок** на одну тему
- 📊 **Подстраивается под реакции**: считает реакции под постами, ≈40% постов подбирает по самым «залайканным» персонажам/тайтлам/авторам; `/stats` — что заходит
- 🏆 **«Топ недели»**: по воскресеньям в 20:00 публикует 5 лучших постов недели со ссылками
- ⚔️ **«Битва артов»**: иногда — два персонажа и опрос «Кто круче?»; голоса тоже учитываются во вкусах канала
- 🖼 Под постами канала — кнопка **View original**
- 🛠 **Админка** (`ADMIN_IDS`): `/admin`, `/post` (запостить сейчас), `/pause`, `/resume`, `/recap`

**Надёжность («работает годами»)**
- 🩺 `/health` — хостинг сам перезапускает бота при зависании
- 🚨 уведомления админу в Telegram о сбоях и восстановлении
- ⏳ экспоненциальные паузы при сбоях Danbooru/Telegram, лимит картинок в час на пользователя
- 🤖 GitHub Actions: тесты на каждый push, еженедельная проверка API Danbooru, Dependabot обновляет зависимости
- 💾 кэш поверх Redis — бесплатного Upstash хватает с запасом

☁️ Два режима запуска: постоянный сервер (Render/VPS) или **serverless на Vercel** (бот «спит», пока нет сообщений).

## 🗂 Структура

```
api/                    — функции Vercel
  webhook.js            — приём обновлений от Telegram
  autopost.js           — один автопост (дёргается cron-ом)
  digest.js             — рассылка по подпискам (дёргается cron-ом)
scripts/setWebhook.js   — установка/удаление webhook
src/
  index.js              — запуск в режиме polling (Render, VPS, локально)
  server.js             — HTTP: / и /health
  app.js                — сборка зависимостей
  config.js             — настройки из переменных окружения
  bot/
    createBot.js        — регистрация обработчиков
    searchRunner.js     — поиск и отправка картинок пользователю
    request.js          — формат запроса в сообщении и клавиатуры
    chatState.js        — «занят»/уже показанное для каждого чата
    handlers/
      start.js          — /start, /help, /tags
      search.js         — текстовый поиск, рейтинг, /random, /top
      postActions.js    — ❤️, похожие, ещё автора/персонажа
      favorites.js      — /favs
      blocklist.js      — /block, /unblock, /blocklist
      subscriptions.js  — /sub, /subs
      reverse.js        — поиск по картинке
      inline.js         — inline-режим
      channel.js        — реакции в канале, /stats
      settings.js       — /settings
      forYou.js         — /foryou
      quiz.js           — /quiz, /quiztop
      info.js           — /info
      admin.js          — /admin, /post, /pause, /resume, /recap
      profile.js        — /me, /history, /wallpaper
  services/
    danbooru.js         — клиент API Danbooru
    tagResolver.js      — «текст пользователя» → теги Danbooru
    postSearch.js       — поиск постов с учётом лимита тегов
    sender.js           — отправка в Telegram (фото, gif, видео, альбомы)
    autopost.js         — автопост, альбомы, тихие часы, подстройка под реакции
    subscriptions.js    — ежедневная рассылка
    recap.js            — «Топ недели» в канале
    alerts.js           — уведомления админу о сбоях
    health.js           — состояние для /health
    danbooruContract.js — проверка API Danbooru (scripts/checkDanbooru.js)
    reverseSearch.js    — IQDB Danbooru + запасной iqdb.org
    channelStats.js     — статистика реакций
    userData.js         — избранное, блок-лист, подписки
    store.js, history.js, redis.js — хранилища (файл / Redis / память)
  utils/                — разбор запроса, подписи, рейтинги, транслит, вики-разметка, время
test/                   — тесты (npm test)
```

## 🚀 Запуск

```bash
npm install
cp .env.example .env   # заполни BOT_TOKEN
node --env-file=.env src/index.js
npm test               # ~200 тестов
npm run check:danbooru # проверить живой API Danbooru
npm run test:coverage  # с отчётом покрытия
```

### Настройка в Telegram

- **Inline-режим**: @BotFather → `/setinline` → выбери бота → текст-подсказка (например «miku, rem…»).
- **Реакции в канале**: бот должен быть **администратором канала** (он и так им является, чтобы постить). Реакции должны быть включены в настройках канала.

### Render / VPS (polling)

Start command: `npm start` (или старая `node main.js` — тоже работает).
Автопост идёт по таймеру `AUTOPOST_INTERVAL`, рассылка по подпискам — раз в день после `DIGEST_HOUR`.
Данные (избранное, подписки, статистика) хранятся в `data/store.json`.

> ⚠️ На бесплатном Render диск стирается при каждом деплое/перезапуске. Чтобы избранное и подписки не терялись, подключи бесплатный Upstash Redis (переменные `UPSTASH_REDIS_REST_URL` и `UPSTASH_REDIS_REST_TOKEN`) — бот сам начнёт хранить всё там.

### Vercel (serverless, экономит лимиты)

1. Импортируй репозиторий в Vercel. Никаких настроек сборки не нужно.
2. Storage → подключи **Upstash Redis** (бесплатно). Переменные `KV_REST_API_*` / `UPSTASH_REDIS_REST_*` подхватятся сами. Без Redis избранное, подписки и история не сохраняются.
3. Добавь переменные: `BOT_TOKEN`, `GROUP_ID`, `WEBHOOK_SECRET`, `CRON_SECRET`.
4. Установи webhook (один раз, локально):
   ```bash
   BOT_TOKEN=... WEBHOOK_URL=https://<проект>.vercel.app/api/webhook WEBHOOK_SECRET=... npm run webhook:set
   ```
5. Cron: на бесплатном тарифе Vercel cron запускается только раз в день, поэтому используй бесплатный [cron-job.org](https://cron-job.org):
   - автопост: `https://<проект>.vercel.app/api/autopost?secret=<CRON_SECRET>` — например каждые 5–10 минут (в тихие часы ответит `quiet`);
   - подписки: `https://<проект>.vercel.app/api/digest?secret=<CRON_SECRET>` — раз в час (рассылка уйдёт один раз в день после `DIGEST_HOUR`).

> ⚠️ Одновременно работать может только один режим: webhook (Vercel) **или** polling (Render). Чтобы вернуться на polling — `npm run webhook:delete`.

## ⚙️ Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `BOT_TOKEN` | — | токен бота (обязательно) |
| `GROUP_ID` | `@Obitel_Dionisa` | канал для автопоста |
| `AUTOPOST` | `on` | `off` — выключить автопост |
| `AUTOPOST_INTERVAL` | `60` | интервал автопоста в секундах (polling) |
| `QUIET_HOURS` | `23:30-06:00` | тихие часы автопоста, `off` — выключить |
| `TZ_NAME` | `Europe/Warsaw` | часовой пояс для тихих часов и рассылки |
| `ALBUM_EVERY` | `8` | примерно каждый N-й автопост — альбом, `0` — без альбомов |
| `ADAPTIVE_SHARE` | `0.4` | доля автопостов по «залайканным» тегам |
| `DIGEST_HOUR` | `12` | час ежедневной рассылки по подпискам |
| `ADMIN_IDS` | — | админы: `/admin`, `/post`, `/pause`…; ограничивает `/stats` (пусто — `/stats` всем, админка выключена) |
| `RECAP`, `RECAP_WEEKDAY`, `RECAP_HOUR` | `on`, `0`, `20` | «Топ недели» в канале (0 — воскресенье) |
| `DANBOORU_LOGIN`, `DANBOORU_API_KEY` | — | аккаунт Danbooru (необязательно) |
| `DANBOORU_TAG_LIMIT` | `2` | лимит тегов в одном запросе к API (6 — Gold, 12 — Platinum) |
| `WEBHOOK_SECRET` | — | секрет webhook (Vercel) |
| `CRON_SECRET` | — | секрет для `/api/autopost` и `/api/digest` |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | — | Redis (обязателен на Vercel, желателен на Render) |
| `HISTORY_FILE` | `./data/sent_images.json` | файл истории автопоста (без Redis) |
| `STORE_FILE` | `./data/store.json` | файл с данными пользователей (без Redis) |

---

## 🇵🇱 Opis

Bot Telegram, który wyszukuje ilustracje na Danbooru według zapytań użytkownika (postacie, anime, tagi), szuka źródła obrazka, ma tryb inline, ulubione, subskrypcje i czarną listę tagów, oraz automatycznie publikuje obrazki w kanale — dopasowując się do reakcji widzów, z przerwą nocną 23:30–06:00. Działa na Render (polling) lub na Vercel (webhook, serverless).

## 🇬🇧 Description

A Telegram bot that searches Danbooru for illustrations by user query (characters, titles, tags, exclusions, rating selection), does reverse image search, inline mode, favorites, daily subscriptions and per-user tag blocklists, and auto-posts to a channel (single images and albums) adapting to subscribers' reactions, with quiet hours (23:30–06:00). Runs either as a long-polling service (Render/VPS) or serverless on Vercel (webhook).

![image](https://github.com/user-attachments/assets/4ed1db69-fc56-47b4-a38f-ba42e786cc43)
![image](https://github.com/user-attachments/assets/4e00eef9-bbea-435c-abfd-cf67ef80ea78)
