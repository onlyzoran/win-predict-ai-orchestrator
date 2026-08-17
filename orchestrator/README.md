# Оркестратор

Менеджер читает Goal Issue и возвращает JSON-план. Диспетчер создаёт child issues и запускает воркеров.

```
orchestrator/
  prompts/manager.md
  prompts/worker.md          # исполнитель ui/app/admin/data на My Machines
  schema/plan.schema.json
  schema/plan.example.json
  src/run.ts
  ops/cursor-worker.service  # systemd на VPS
  prompts/design.md          # вкус и палитра для ui/app/admin
```

## `/orchestrate` и доска

Комментарий `/orchestrate` на Goal Issue (лейбл `goal`) — запасной старт. Основной жест: карточка на доске.

1. Goal **Inbox → In Progress** (или `/orchestrate`): local-агент на GitHub runner собирает план, child issues, Goal → **In Progress**, воркеры.
2. Диспетчер:
   - `slash` `/new-icon` → комментарий, **ждёт PR**
   - `ui` / `sdk` → My Machines `win-predict-vps` (`worker.md`)
3. Успех: child и Goal → **Review**. **Done** и merge — человек.
4. Правка: комментарий в **issue** (не в PR) и карточка **Review → In Progress**. Action `board-watch` (cron 2 мин) поднимает Goal → оркестратор или child → воркер MODE B (та же ветка PR).

Если план уже есть, повторный `/orchestrate` только догоняет воркеров (не плодит issues). С нуля: `/orchestrate redo`. Ошибка старта воркера **не** ставит `DISPATCH_MARKER` на Goal — `/orchestrate` или возврат в In Progress можно повторить.

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

- Клоны: `/opt/cursor-workers/{win-predict-ai,win-predict-ai-admin,win-predict-ai-data,win-predict-ai-ui}`
- Прод админки `/var/www/win-predict-ai-admin` не монтировать в `--worker-dir`
- Юнит: `orchestrator/ops/cursor-worker.service`
- Проверка: `agent worker debug`, машина в [cursor.com/agents](https://cursor.com/agents)

## Модули

| Модуль | Сейчас |
|---|---|
| decompose | local `Agent.prompt` |
| dispatch | issues + slash `/new-icon` или My Machines `worker.md` |
| watch | cron по доске: In Progress после Review → оркестратор или воркер; Done и merge вручную |
