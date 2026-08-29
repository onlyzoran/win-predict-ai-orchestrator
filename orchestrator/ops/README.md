# VPS: My Machines + board-watch

Машина: `win-predict-vps`. Пользователь юнитов: `cursor-worker`. Секреты: `/etc/cursor-worker.env` (образец `cursor-worker.env.example`).

## My Machines worker

Юнит: `cursor-worker.service` → `agent worker --name win-predict-vps`.

Клоны: `/opt/cursor-workers/{win-predict-ai,win-predict-ai-admin,win-predict-ai-data,win-predict-ai-ui,win-predict-ai-ios}`. Прод админки `/var/www/win-predict-ai-admin` сюда не монтировать.

`win-predict-ai-ios` — исходники SwiftUI; на VPS нет Xcode, воркер только правит файлы и открывает PR.

## Board watch

Таймер `board-watch.timer` раз в 2 минуты (после окончания прошлого прогона) смотрит доску **In Progress**: первый старт или правка после Review → оркестратор/воркер; Review → In Progress без комментария → sync main (`update-branch`, при конфликте MODE B); комментарий «релизь» / «можно релизить» после Review → bump версии + ченджлог, merge PR, Done. Старые карточки в legacy-колонке Ready to Release тоже ещё релизятся.

GitHub Actions для опроса доски не используем: короткий schedule там ненадёжен, ручной workflow с ноутбука запускал бы второй вотчер параллельно с таймером. Если VPS молчит — `systemctl start board-watch.service`.

### Поставить один раз

На VPS, от root. PAT тот же, что секрет `GITHUB_PAT`.

```bash
install -d -o cursor-worker -g cursor-worker /opt/cursor-workers/win-predict-ai-orchestrator
sudo -u cursor-worker git clone https://github.com/onlyzoran/win-predict-ai-orchestrator.git \
  /opt/cursor-workers/win-predict-ai-orchestrator
chmod +x /opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/board-watch.sh
sudo -u cursor-worker bash -lc 'cd /opt/cursor-workers/win-predict-ai-orchestrator && npm ci'

# В /etc/cursor-worker.env: CURSOR_API_KEY, GITHUB_PAT,
# TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID (те же, что GitHub secrets).
# Без TELEGRAM_* вотчер и воркеры в чат не пишут.

install -m 644 /opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/board-watch.service /etc/systemd/system/
install -m 644 /opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/board-watch.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now board-watch.timer
```

Приватный clone: если HTTPS без ключа не идёт, `git clone https://<TOKEN>@github.com/onlyzoran/win-predict-ai-orchestrator.git` один раз, в remote токен не оставлять — дальше `board-watch.sh` ходит через `GITHUB_PAT`.

### Проверка

```bash
systemctl list-timers board-watch.timer
systemctl start board-watch.service
journalctl -u board-watch.service -n 50 --no-pager
```

В логе пустой доски: `watch: 0 goal, 0 child in In Progress`. Карточка в In Progress после Review без комментария: `Review→IP без комментария → sync main`. С замечаниями: запуск воркера. С фразой «релизь»: `release intent → releaser`.

Инвентарь слота (кто занял машину): `/opt/cursor-workers/data/inventory.json`. Файл появляется на тике вотчера (даже если слот свободен). При смене слота снимок уходит в Telegram (`слот 1/1` / `свободно`).

## HQ (внешний pitch)

Лендинг штаба: [https://hq.win-predict-ai.com](https://hq.win-predict-ai.com) — см. [hq/README.md](hq/README.md). Деплой: `install-hq.sh`.

## Статус UI

Отдельная страница на том же IP, не внутри Nuxt: [http://202.71.15.138/ops/](http://202.71.15.138/ops/). Слот, текущая задача, последний прогон, карточки In Progress / Review. Опрос каждые 4 с.

Один раз от root, после того как этот репо уже на `origin/main`:

```bash
chmod +x /opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/install-status.sh
/opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/install-status.sh
```

Скрипт создаёт `/var/www/orchestrator-status` и nginx snippet. Дальше вручную: в `server { listen 80; }` (тот, что отдаёт Nuxt) **до** `location /` добавь:

```nginx
include /etc/nginx/snippets/orchestrator-status.conf;
```

```bash
nginx -t && systemctl reload nginx
systemctl start board-watch.service
```

`/status` и `/orchestrator` заняты SPA — не использовать. Если править Nuxt-сайт не хочется: `ln -s /etc/nginx/sites-available/orchestrator-status /etc/nginx/sites-enabled/` и открыть порт **8787** → `http://202.71.15.138:8787/`.
