# Оркестратор

Менеджер читает Goal Issue и возвращает JSON-план. Диспетчер создаёт child issues и запускает воркеров.

```
orchestrator/
  prompts/manager.md
  prompts/worker.md          # общий исполнитель (app/admin/data) на My Machines
  schema/plan.schema.json
  schema/plan.example.json
  src/run.ts
  ops/cursor-worker.service  # systemd на VPS
  prompts/design.md          # вкус и палитра для ui/app/admin
```

## `/orchestrate`

Комментарий `/orchestrate` на Goal Issue (лейбл `goal`):

1. Local-агент на GitHub runner собирает план
2. Child issues в рабочих репо + доска, Goal → **In Progress**
3. Диспетчер:
   - `slash` `/new-icon` → комментарий, **ждёт PR**
   - `/ui-agent` из плана и `sdk` / `issue_only` → My Machines `win-predict-vps` (не Cursor Automation: иначе Rate limited)
4. Успешный `worker.md`: child и Goal → **Review**, комментарий «нужна приёмка» + URL PR. **Done** и merge — человек.

Если план уже есть, повторный `/orchestrate` только догоняет воркеров (не плодит issues). С нуля: `/orchestrate redo`. Ошибка старта воркера **не** ставит `DISPATCH_MARKER` на Goal — `/orchestrate` можно повторить.

## Секреты репо

| Secret | Зачем |
|---|---|
| `CURSOR_API_KEY` | персональный user key; менеджер (local) и воркеры (My Machines). Тот же ключ / тот же Cursor-аккаунт, что у `agent worker start` на VPS |
| `ORCHESTRATOR_GITHUB_TOKEN` | PAT: `repo` + `project`; в сессии воркера как `$GH_TOKEN` |
| `TELEGRAM_BOT_TOKEN` | бот для коротких событий `/orchestrate` (не сырой лог) |
| `TELEGRAM_CHAT_ID` | чат, куда писать |

`CURSOR_MACHINE_NAME` в Action = `win-predict-vps` (не секрет).

## My Machines на VPS

Не Cursor-hosted VM и не Self-Hosted Pool (`--pool`). Worker-процесс на VPS, модель в Cursor.

- Клоны: `/opt/cursor-workers/{win-predict-ai,win-predict-ai-admin,win-predict-ai-data}`
- Прод админки `/var/www/win-predict-ai-admin` не монтировать в `--worker-dir`
- Юнит: `orchestrator/ops/cursor-worker.service`
- Проверка: `agent worker debug`, машина в [cursor.com/agents](https://cursor.com/agents)

## Модули

| Модуль | Сейчас |
|---|---|
| decompose | local `Agent.prompt` |
| dispatch | issues + slash или My Machines `worker.md` |
| watch | после `worker.md` — колонка Review; Done и merge вручную |
