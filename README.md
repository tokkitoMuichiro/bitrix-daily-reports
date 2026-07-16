# СтройОтчёт — ежедневные отчёты в Битрикс24

Веб-приложение на Node.js:

1. Работник выбирает **объект** (задачу Битрикс) и заполняет отчёт  
2. Отчёт сохраняется **файлом `.txt` на Диске** Битрикс  
3. Вкладка **Архив**: объект → дата → просмотр отчёта  

Структура на Диске:

```text
Ежедневные отчёты/
  task-101/
    2026-07-15.txt
    2026-07-14.txt
  task-102/
    2026-07-15.txt
```

## Быстрый старт (демо без Битрикс)

```powershell
cd C:\Users\pto\bitrix-daily-reports
copy .env.example .env
npm install
npm run dev
```

Откройте http://localhost:3000  

- **Новый отчёт** — сохранит файл в `data/mock-disk/`  
- **Архив** — объект → дата → текст  

## Подключение к Битрикс24

1. Входящий вебхук с правами: `task`, `tasks`, `disk`  
2. В `.env`:

```env
BITRIX_WEBHOOK_URL=https://ВАШ_ПОРТАЛ.bitrix24.ru/rest/1/xxxx/
MOCK_BITRIX=0
DISK_REPORTS_FOLDER_NAME=Ежедневные отчёты
```

Опционально укажите готовый ID папки: `DISK_FOLDER_ID=12345`  
(Диск → папка → в URL или свойствах объекта).

3. Перезапустите `npm run dev` / `npm start`

## Доступ только сотрудникам Битрикс

По умолчанию на боевом режиме сайт требует вход через **локальное приложение** Битрикс24 (`AUTH_ID`).

Подробно: [AUTH.md](./docs/AUTH.md)

Кратко в `.env` на сервере:

```env
BITRIX_PORTAL_DOMAIN=ammir.bitrix24.ru
REQUIRE_BITRIX_AUTH=1
```

Для локальной разработки без Битрикс: `REQUIRE_BITRIX_AUTH=0`.

На боевом сервере нужен **постоянный хостинг с HTTPS** — иначе бот работает только пока включён ваш ПК.

## Эксплуатация и сервер

**Подробная шпаргалка:** [OPERATIONS.md](./docs/OPERATIONS.md)

Там: обновление кода (Git), PM2 (старт/стоп/перезапуск), nginx, HTTPS, логи, типичные ошибки, Битрикс-меню, мобилка, чеклисты.

## Структура проекта

```
src/                 — сервер Express
  config.js          — dotenv, port, пути
  middleware/        — auth, iframe (CSP)
  services/          — Bitrix API и диск
  routes/api.js      — HTTP API
  server.js          — точка входа
public/              — фронтенд (html, css/, js/)
docs/                — AUTH.md, OPERATIONS.md
```
