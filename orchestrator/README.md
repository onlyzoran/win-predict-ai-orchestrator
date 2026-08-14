# Оркестратор

Менеджер читает Goal Issue и возвращает JSON-план. Диспетчер в GitHub Action создаёт child issues.

```
orchestrator/
  prompts/manager.md
  schema/plan.schema.json
  schema/plan.example.json
  src/run.ts                 # Action /orchestrate
```

## `/orchestrate`

Комментарий `/orchestrate` на Goal Issue (лейбл `goal`):

1. Локальный агент в GitHub Action (Cursor SDK) собирает план — cloud VM не нужна
2. Диспетчер создаёт child issues в рабочих репо, ставит лейблы поверхностей
3. Goal и children попадают на доску; Goal → **In Progress**
4. Воркеров (`/ui-agent`, `/new-icon`) пока не запускает

Повтор: `/orchestrate redo`.

## Секреты репо

| Secret | Зачем |
|---|---|
| `CURSOR_API_KEY` | вызов менеджера ([Integrations](https://cursor.com/dashboard/integrations)) |
| `ORCHESTRATOR_GITHUB_TOKEN` | PAT: scopes `repo` + `project`, доступ ко всем шести репо семьи |

Менеджер не клонирует репо в cloud VM: план собирается local-агентом на раннере GitHub Actions.

## Модули

| Модуль | Сейчас |
|---|---|
| decompose | `Agent.prompt` + схема |
| dispatch | `gh issue create`, лейблы, Project |
| watch | ещё нет — slash вручную |
