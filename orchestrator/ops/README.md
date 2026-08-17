# VPS: My Machines + board-watch

Машина: `win-predict-vps`. Пользователь юнитов: `cursor-worker`. Секреты: `/etc/cursor-worker.env` (образец `cursor-worker.env.example`).

## My Machines worker

Юнит: `cursor-worker.service` → `agent worker --name win-predict-vps`.

Клоны: `/opt/cursor-workers/{win-predict-ai,win-predict-ai-admin,win-predict-ai-data,win-predict-ai-ui}`. Прод админки `/var/www/win-predict-ai-admin` сюда не монтировать.

## Board watch

Таймер `board-watch.timer` раз в 2 минуты (после окончания прошлого прогона) смотрит доску: карточка Review → In Progress → оркестратор или воркер.

GitHub Actions для опроса доски не используем: короткий schedule там ненадёжен, ручной workflow с ноутбука запускал бы второй вотчер параллельно с таймером. Если VPS молчит — `systemctl start board-watch.service`.

### Поставить один раз

На VPS, от root. PAT тот же, что секрет `ORCHESTRATOR_GITHUB_TOKEN`.

```bash
install -d -o cursor-worker -g cursor-worker /opt/cursor-workers/win-predict-ai-orchestrator
sudo -u cursor-worker git clone https://github.com/onlyzoran/win-predict-ai-orchestrator.git \
  /opt/cursor-workers/win-predict-ai-orchestrator
chmod +x /opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/board-watch.sh
sudo -u cursor-worker bash -lc 'cd /opt/cursor-workers/win-predict-ai-orchestrator && npm ci'

# В /etc/cursor-worker.env: CURSOR_API_KEY, ORCHESTRATOR_GITHUB_TOKEN,
# TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID (те же, что GitHub secrets).
# Без TELEGRAM_* вотчер и воркеры в чат не пишут.

install -m 644 /opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/board-watch.service /etc/systemd/system/
install -m 644 /opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/board-watch.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now board-watch.timer
```

Приватный clone: если HTTPS без ключа не идёт, `git clone https://<TOKEN>@github.com/onlyzoran/win-predict-ai-orchestrator.git` один раз, в remote токен не оставлять — дальше `board-watch.sh` ходит через `ORCHESTRATOR_GITHUB_TOKEN`.

### Проверка

```bash
systemctl list-timers board-watch.timer
systemctl start board-watch.service
journalctl -u board-watch.service -n 50 --no-pager
```

В логе пустой доски: `watch: 0 goal, 0 child in In Progress`. Карточка в In Progress после Review: `watch: 1 child` (или `1 goal`) и дальше запуск воркера.
