# VPS: My Machines + board-watch

Машина: `win-predict-vps`. Пользователь юнитов: `cursor-worker`. Секреты: `/etc/cursor-worker.env` (образец `cursor-worker.env.example`).

## My Machines worker

Юнит: `cursor-worker.service` → `agent worker --name win-predict-vps`.

Клоны: `/opt/cursor-workers/{win-predict-ai,win-predict-ai-admin,win-predict-ai-data,win-predict-ai-ui,win-predict-ai-ios,shoppable-feed,gift-sales}`. Прод админки `/var/www/win-predict-ai-admin` сюда не монтировать.

`win-predict-ai-ios` — исходники SwiftUI; на VPS нет Xcode, воркер только правит файлы и открывает PR.

`shoppable-feed` — отдельный продукт, один клон: `git clone https://github.com/onlyzoran/shoppable-feed.git /opt/cursor-workers/shoppable-feed` (владелец `cursor-worker`). После этого перезапусти `cursor-worker.service` (в юните новый `--worker-dir`).

Прод и preview: `http://202.71.15.138/shoppable-feed/` и `…/preview/issue-<N>/`. Preview — dynamic Next.js на порту 3004 (API routes работают). Установка: `orchestrator/ops/install-shoppable-feed.sh` (от root после `git pull`).

`gift-sales` — отдельный продукт, один клон: `git clone https://github.com/onlyzoran/gift-sales.git /opt/cursor-workers/gift-sales` (владелец `cursor-worker`). После этого перезапусти `cursor-worker.service` (в юните новый `--worker-dir`).

**ios-games** — per-Goal репо `onlyzoran/game-issue-<N>`. После scaffold (комментарий `<!-- orchestrator-game-repo:… -->` на Goal) на VPS от root:

```bash
chmod +x /opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/ensure-game-worker.sh
/opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/ensure-game-worker.sh onlyzoran/game-issue-42
```

Или задай `ORCHESTRATOR_VPS_SSH=root@<host>` на машине, где крутится оркестратор — scaffold вызовет скрипт по SSH.

На VPS нет Xcode — воркер правит Swift/ресурсы и открывает PR; сборка на Mac человека.

Прод и preview: `http://202.71.15.138/gift-sales/` и `…/preview/issue-<N>/`. Установка nginx + systemd: `orchestrator/ops/install-gift-sales.sh` (от root после `git pull`). После merge PR в релизе Goal оркестратор запускает `gift-sales-deploy.sh` (клон `/opt/cursor-workers/gift-sales`, `npm ci && build`, `systemctl restart gift-sales.service`).

**Preview deploy (gift-sales, shoppable-feed):** board-watch поднимает demo автоматически — перед ревью, при переводе Goal в Review и при backfill карточек в Review (если URL отдаёт 404). Скрипты ищут open PR по маркеру `Parent: …/win-predict-ai-orchestrator#<N>` в body и билдят head SHA. Ручная проверка:

```bash
sudo -u cursor-worker bash /opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/gift-sales-preview-up.sh 69
curl -I http://202.71.15.138/gift-sales/preview/issue-69/
```

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

### Browser review (Playwright MCP)

Local-ревьюер для ui/app/admin/gift-sales/feed с demo URL ждёт preview (до 3 мин) и открывает его через Playwright MCP (`@playwright/mcp`, headless). На VPS под пользователем `cursor-worker` нужны Node ≥22 и сеть для `npx` (первый прогон скачает Chromium).

```bash
# Проверка от cursor-worker (тот же PATH, что board-watch)
sudo -u cursor-worker bash -lc 'cd /opt/cursor-workers/win-predict-ai-orchestrator && npx -y @playwright/mcp@latest --help'
```

Отключить browser review без деплоя: `ORCHESTRATOR_BROWSER_REVIEW=0` в `/etc/cursor-worker.env`.

### Product-audit (weekly visual prod walk)

Отдельный timer — не в `board-watch`: прогон долгий и не блокирует очередь Goal. Агент (`auditor.md`) обходит prod URL из `orchestrator/config/audit-routes.json` через Playwright MCP и создаёт **draft Goal** в **Inbox** (label `product-audit` + лейбл продукта). Оркестратор не стартует, пока человек не переведёт карточку в In Progress.

Перед первым прогоном создай лейбл `product-audit` в штаб-репо (если ещё нет).

```bash
# Ручной прогон (dry-run — без issues)
ORCHESTRATOR_AUDIT_DRY_RUN=1 npm run audit -- win-predict-ai

# Боевой прогон
npm run audit -- win-predict-ai
```

Env (в `/etc/cursor-worker.env`):

| Переменная | Default | Смысл |
|---|---|---|
| `ORCHESTRATOR_AUDIT_ENABLED` | `1` | `0` — no-op |
| `ORCHESTRATOR_AUDIT_MIN_SEVERITY` | `medium` | порог создания Goal (`low`/`medium`/`high`) |
| `ORCHESTRATOR_AUDIT_DRY_RUN` | — | `1` — только отчёт, без issues |

Поставить weekly timer (от root, после `git pull`):

```bash
chmod +x /opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/product-audit.sh
install -m 644 /opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/product-audit.service /etc/systemd/system/
install -m 644 /opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/product-audit.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now product-audit.timer
systemctl start product-audit.service   # разовый прогон
journalctl -u product-audit.service -n 80 --no-pager
```

Инвентарь слота (кто занял машину): `/opt/cursor-workers/data/inventory.json`. Файл появляется на тике вотчера (даже если слот свободен). При смене слота снимок уходит в Telegram (`слот 1/1` / `свободно`).

## HQ (внешний pitch)

Лендинг-схемы штаба (React Flow): [https://hq.win-predict-ai.com](https://hq.win-predict-ai.com) — см. [hq/README.md](hq/README.md). Деплой: `install-hq.sh` (собирает `dist/`).

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
