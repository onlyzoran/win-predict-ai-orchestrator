# Оркестратор

Менеджер читает Goal Issue и возвращает JSON-план. Диспетчер создаёт child issues и запускает воркеров.

```
orchestrator/
  prompts/manager.md
  prompts/worker.md          # общий исполнитель (app/admin/data)
  schema/plan.schema.json
  schema/plan.example.json
  src/run.ts
```

## `/orchestrate`

Комментарий `/orchestrate` на Goal Issue (лейбл `goal`):

1. Local-агент на GitHub runner собирает план
2. Child issues в рабочих репо + доска, Goal → **In Progress**
3. Диспетчер:
   - `slash` → комментарий `/ui-agent` или `/new-icon` (существующие Automations)
   - `issue_only` / `sdk` → cloud-агент с `worker.md` в целевом репо

Если план уже есть, повторный `/orchestrate` только догоняет воркеров (не плодит issues). С нуля: `/orchestrate redo`.

## Секреты репо

| Secret | Зачем |
|---|---|
| `CURSOR_API_KEY` | менеджер (local) и воркеры (cloud) |
| `ORCHESTRATOR_GITHUB_TOKEN` | PAT: `repo` + `project`; в VM воркера как `$GH_TOKEN` |

В Cursor Dashboard GitHub-аккаунт ключа должен видеть рабочие репо (клонирование cloud VM).

## Модули

| Модуль | Сейчас |
|---|---|
| decompose | local `Agent.prompt` |
| dispatch | issues + slash или cloud `worker.md` |
| watch | нет — merge и колонка Done вручную |
