# Шпаргалка: эксплуатация «АММИР отчёт»

Подробное руководство: локальная разработка, сервер FirstVDS, обновления, перезапуск, диагностика.

---

## Содержание

1. [Архитектура](#архитектура)
2. [Файлы и секреты](#файлы-и-секреты)
3. [Локально на ПК (Windows)](#локально-на-пк-windows)
4. [Сервер FirstVDS (боевой)](#сервер-firstvds-боевой)
5. [Обновление кода](#обновление-кода)
6. [PM2: запуск, остановка, перезапуск](#pm2-запуск-остановка-перезапуск)
7. [Nginx и HTTPS](#nginx-и-https)
8. [Как проверить, что всё живо](#как-проверить-что-всё-живо)
9. [Логи и диагностика](#логи-и-диагностика)
10. [Частые ошибки](#частые-ошибки)
11. [Битрикс24: вебхук, меню, мобилка](#битрикс24-вебхук-меню-мобилка)
12. [Безопасность](#безопасность)
13. [Чеклисты](#чеклисты)

---

## Архитектура

```text
Сотрудник (ПК / телефон)
        │
        ▼
   Битрикс24 (меню / чат со ссылкой)
        │
        ▼
   Nginx (порт 80/443) на VPS
        │
        ▼
   Node.js приложение (порт 3000, PM2)
        │
        ├── REST → Битрикс (задачи, Диск, комментарии)
        └── Файлы отчётов → Диск «Ежедневные отчеты»
```

**Важно:** Битрикс не запускает Node. Приложение крутится на **вашем VPS**. Пока VPS выключен — форма недоступна.

---

## Файлы и секреты

| Файл | Где | Назначение |
|------|-----|------------|
| `.env` | ПК и сервер (отдельно!) | Секреты: вебхук, URL |
| `.env.example` | В Git | Шаблон без секретов |
| `src/server.js` | Git | HTTP-сервер |
| `src/bitrix.js` | Git | Задачи, формат отчёта |
| `src/disk.js` | Git | Сохранение на Диск |
| `public/` | Git | Форма в браузере |

**Никогда не коммитьте `.env` в GitHub** — там URL вебхука с секретом.

### Переменные `.env`

```env
# Входящий вебхук (права: user, task, tasks, disk)
BITRIX_WEBHOOK_URL=https://ammir.bitrix24.ru/rest/36/СЕКРЕТ/

# 0 = боевой режим, 1 = демо (локальные файлы data/mock-disk/)
MOCK_BITRIX=0

# Внутренний порт Node (nginx проксирует сюда)
PORT=3000

# Публичный адрес (для Битрикс меню, без слэша в конце)
APP_PUBLIC_URL=https://reports.ammir.org

# Папка на Диске (имя как в Битрикс — «отчеты», не «отчёты»)
DISK_REPORTS_FOLDER_NAME=Ежедневные отчеты

# ID папки, если уже создана вручную (иначе пусто)
DISK_FOLDER_ID=

# 1 = дублировать отчёт комментарием к задаче (от имени владельца вебхука)
# 0 = только файл на Диске
SAVE_TASK_COMMENT=1
```

После **любого** изменения `.env` на сервере:

```bash
pm2 restart stroy-otchet
```

---

## Локально на ПК (Windows)

### Первый запуск

```powershell
cd C:\Users\pto\bitrix-daily-reports
copy .env.example .env
# отредактируйте .env в блокноте
npm install
```

### Запуск (PowerShell)

Из-за политики скриптов используйте:

```powershell
npm.cmd run dev
```

или напрямую:

```powershell
node --watch src/server.js
```

Откройте: http://localhost:3000

### Остановка локального сервера

В терминале, где крутится сервер: **Ctrl+C**

### Перезапуск локально

1. **Ctrl+C**
2. Снова `npm.cmd run dev`

### Ошибка `EADDRINUSE` (порт 3000 занят)

Значит уже запущен другой экземпляр. В PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Потом снова `npm.cmd run dev`.

**Правило:** держите **один** терминал с сервером. Не запускайте второй `npm run dev`.

### Git Bash

```bash
cd ~/bitrix-daily-reports
npm run dev
```

Путь `C:\Users\...` в Git Bash не используйте — пишите `~/bitrix-daily-reports`.

---

## Сервер FirstVDS (боевой)

Типичные пути на сервере:

```text
/var/www/bitrix-daily-reports/   — код проекта
/etc/nginx/sites-available/      — конфиг nginx
```

Подключение:

```bash
ssh root@ВАШ_IP
```

### Первичная установка (если ещё не делали)

```bash
apt update && apt upgrade -y
apt install -y nginx git curl

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

mkdir -p /var/www
cd /var/www
git clone https://github.com/tokkitoMuichiro/bitrix-daily-reports.git
cd bitrix-daily-reports
npm install

nano .env
# заполните по шаблону выше

npm install -g pm2
pm2 start src/server.js --name stroy-otchet
pm2 save
pm2 startup
# выполните команду, которую выведет pm2 startup
```

---

## Обновление кода

### Стандартный цикл (рекомендуется)

**На ПК** — внесли изменения, проверили локально:

```powershell
cd C:\Users\pto\bitrix-daily-reports
git status
git add .
git commit -m "описание изменения"
git push origin main
```

**На сервере:**

```bash
cd /var/www/bitrix-daily-reports
git pull origin main
npm install
pm2 restart stroy-otchet
```

### Если меняли только фронт (HTML/CSS/JS)

Достаточно:

```bash
git pull
pm2 restart stroy-otchet
```

`npm install` — только если менялся `package.json`.

### Если меняли `.env` на сервере

`git pull` **не** трогает `.env` (его нет в Git). Редактируйте вручную:

```bash
nano .env
pm2 restart stroy-otchet
```

### Откат на предыдущую версию

```bash
cd /var/www/bitrix-daily-reports
git log --oneline -5
git checkout ХЕШ_КОММИТА
pm2 restart stroy-otchet
```

Вернуться на последнюю:

```bash
git checkout main
git pull
pm2 restart stroy-otchet
```

---

## PM2: запуск, остановка, перезапуск

Имя процесса в примерах: **`stroy-otchet`**

### Статус (главная команда)

```bash
pm2 status
```

| Колонка | Значение |
|---------|----------|
| `online` | Работает |
| `stopped` | Остановлен вручную |
| `errored` | Упал, смотрите логи |

### Запуск

```bash
cd /var/www/bitrix-daily-reports
pm2 start src/server.js --name stroy-otchet
```

### Остановка

```bash
pm2 stop stroy-otchet
```

Приложение недоступно снаружи, пока не запустите снова.

### Перезапуск (после обновления кода или `.env`)

```bash
pm2 restart stroy-otchet
```

### Удалить из PM2 (редко)

```bash
pm2 delete stroy-otchet
pm2 start src/server.js --name stroy-otchet
pm2 save
```

### Автозапуск после перезагрузки VPS

Один раз:

```bash
pm2 save
pm2 startup
```

Выполните команду, которую выведет `pm2 startup` (с `sudo`).

Проверка: перезагрузите VPS (`reboot`), зайдите снова — `pm2 status` должен показать `online`.

### Логи PM2

```bash
pm2 logs stroy-otchet
pm2 logs stroy-otchet --lines 100
```

Выход: **Ctrl+C**

Очистить старые логи:

```bash
pm2 flush stroy-otchet
```

---

## Nginx и HTTPS

### Проверка nginx

```bash
nginx -t
systemctl status nginx
systemctl reload nginx
systemctl restart nginx
```

### Перезапуск всего «веба»

```bash
pm2 restart stroy-otchet
systemctl reload nginx
```

### HTTPS (когда есть домен, например reports.ammir.org)

DNS: запись **A** `reports` → IP сервера.

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d reports.ammir.org
```

В `.env`:

```env
APP_PUBLIC_URL=https://reports.ammir.org
```

```bash
pm2 restart stroy-otchet
```

Обновите URL в **локальном приложении** Битрикс (меню).

Сертификат продлевается автоматически; проверка:

```bash
certbot renew --dry-run
```

### Порты на VPS

Должны быть открыты:

- **22** — SSH
- **80** — HTTP
- **443** — HTTPS

В панели FirstVDS / firewall проверьте, если сайт не открывается снаружи.

---

## Как проверить, что всё живо

### На сервере (SSH)

```bash
# Node отвечает
curl http://127.0.0.1:3000/health
# ожидается: {"ok":true}

curl http://127.0.0.1:3000/api/status
# mockMode: false, storage: bitrix-disk

# Через nginx (снаружи)
curl -I http://ВАШ_IP/
```

### С ПК / телефона

- Открыть URL в браузере
- **Новый отчёт** — список задач
- Сохранить тестовый отчёт
- **Диск Битрикс** → «Ежедневные отчеты» → `task-XXXX` → файл с датой
- **Архив** — объект → дата → текст

### Мониторинг «на глаз» (раз в день)

```bash
pm2 status
df -h
free -h
uptime
```

Для 20 пользователей нагрузка минимальная; если `pm2` показывает `errored` — смотрите логи.

### Простой внешний мониторинг (опционально)

Бесплатные сервисы пингуют URL раз в 5 минут и шлют письмо, если сайт лёг (UptimeRobot и аналоги). URL: `https://reports.ammir.org/health`

---

## Логи и диагностика

### Где смотреть при сбое

1. `pm2 logs stroy-otchet` — ошибки Node, Bitrix API
2. `/var/log/nginx/error.log` — nginx
3. Браузер → F12 → Network — если форма не сохраняется

### Типичные сообщения в логах

| Сообщение | Значение |
|-----------|----------|
| `Bitrix disk.folder...` | Проблема с Диском / имя папки |
| `insufficient_scope` | Не хватает прав вебхука |
| `EADDRINUSE` | Порт 3000 занят (локально) |
| `Не настроен BITRIX_WEBHOOK_URL` | Пустой или неверный `.env` |

### Проверка вебхука (в браузере, секрет не светить)

```text
https://ammir.bitrix24.ru/rest/36/СЕКРЕТ/scope
```

Должны быть: `user`, `task`, `tasks`, `disk` (и при необходимости `im`, `imbot`).

---

## Частые ошибки

### «Failed to fetch» в форме

- Сервер не запущен (`pm2 status`)
- Неверный URL / firewall
- Локально: два `npm run dev` → `EADDRINUSE`
- Ошибка 502 от API — смотрите `pm2 logs`

### Отчёты от вашего имени в задаче

Вебхук создан от вашего пользователя. Варианты:

- `SAVE_TASK_COMMENT=0` — только Диск
- Новый вебхук от служебного пользователя «Робот отчётов»

### Папка на Диске не создаётся

- Право `disk` у вебхука
- Имя папки: `Ежедневные отчеты` (буква **е**, не **ё**)
- `MOCK_BITRIX=0` на сервере

### Белый экран в меню Битрикс

- Нужен HTTPS для стабильной работы в iframe
- URL в приложении = `APP_PUBLIC_URL`
- Сервер доступен с интернета

### После `git pull` всё сломалось

```bash
npm install
pm2 restart stroy-otchet
pm2 logs stroy-otchet --lines 50
```

### Забыли пароль root / не заходите по SSH

Восстановление через панель FirstVDS (консоль VNC / сброс пароля).

---

## Битрикс24: вебхук, меню, мобилка

### Вход только для сотрудников (AUTH_ID)

См. подробную инструкцию: [AUTH.md](./AUTH.md)

На сервере в `.env`:

```env
BITRIX_PORTAL_DOMAIN=ammir.bitrix24.ru
REQUIRE_BITRIX_AUTH=1
```

```bash
pm2 restart stroy-otchet
```

Прямой заход по IP без Битрикс будет закрыт. Открывать нужно из **локального приложения** в меню портала.

### Входящий вебхук

**Разработчикам → Другое → Входящий вебхук**

Права: `user`, `task`, `tasks`, `disk`

### Кнопка в левом меню (ПК)

**Разработчикам → Локальное приложение**

- URL: `https://reports.ammir.org/` (или `http://IP/` временно)
- Показать в главном меню: **да**
- Название: **АММИР отчёт**

Если пункта нет: настройка левого меню (карандаш) → включить приложение.

### Мобильное приложение Битрикс24

1. Меню → **Ещё** / **Приложения** → **АММИР отчёт**
2. Или закреплённая ссылка в чате (надёжнее)
3. Или «Добавить на главный экран» в Safari/Chrome

Для мобилки **нужен HTTPS**.

### Структура отчётов на Диске

```text
Общий диск / Ежедневные отчеты /
  task-9446/
    2026-07-15.txt
```

---

## Безопасность

1. **Не коммитьте** `.env`, не публикуйте URL вебхука в чатах
2. При утечке секрета — **пересоздайте** входящий вебхук в Битрикс
3. SSH: сильный пароль или ключ; по возможности смените порт 22 (опционально)
4. Регулярно: `apt update && apt upgrade -y` на сервере
5. Бэкап: достаточно GitHub для кода; отчёты — на Диске Битрикс

### Резервная копия `.env` с сервера

Храните копию `.env` **офлайн** (менеджер паролей / зашифрованный файл), не в Git.

---

## Чеклисты

### Ежедневно (если что-то «не работает»)

- [ ] `pm2 status` → `online`
- [ ] Сайт открывается в браузере
- [ ] Тестовый отчёт сохраняется

### После обновления кода

- [ ] `git push` с ПК
- [ ] `git pull` на сервере
- [ ] `npm install` (если менялись зависимости)
- [ ] `pm2 restart stroy-otchet`
- [ ] Проверка формы и архива

### После перезагрузки VPS

- [ ] `pm2 status` (должен быть `online` без ручного старта)
- [ ] `systemctl status nginx`
- [ ] URL открывается

### Новому сотруднику

- [ ] Доступ к пункту меню или чат со ссылкой
- [ ] Кратко: Новый отчёт / Архив
- [ ] Права на Диск (руководителю)

---

## Быстрые команды (копировать)

### Сервер — всё перезапустить

```bash
cd /var/www/bitrix-daily-reports && git pull && npm install && pm2 restart stroy-otchet && pm2 status
```

### Сервер — что сломалось

```bash
pm2 status
pm2 logs stroy-otchet --lines 80
curl http://127.0.0.1:3000/health
nginx -t
```

### ПК — локальная разработка

```powershell
cd C:\Users\pto\bitrix-daily-reports
npm.cmd run dev
```

---

## Полезные ссылки

- Репозиторий: https://github.com/tokkitoMuichiro/bitrix-daily-reports
- Портал: https://ammir.bitrix24.ru
- Сайт компании: https://ammir.org/

---

*Документ для внутреннего использования ООО «АММИР». Обновляйте при смене IP, домена или вебхука.*
