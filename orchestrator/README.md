# Оркестратор

Менеджер читает Goal Issue и возвращает план. Диспетчер (ещё нет) создаст child issues и позже триггернет воркеров.

```
orchestrator/
  prompts/manager.md      # инструкции менеджера
  schema/plan.schema.json # контракт плана
  schema/plan.example.json
```

Код SDK и GitHub Action `/orchestrate` появятся следующим шагом. Сейчас можно вручную: открыть Goal, скормить менеджеру тело issue, проверить JSON по схеме.

## Модули

| Модуль | Сейчас | Потом |
|---|---|---|
| decompose | промпт + JSON-схема | вызов модели / cloud agent |
| dispatch | — | создать child issues, лейблы, комментарий к Goal |
| watch | — | PR/CI, колонки Project, `/ui-agent` и `/new-icon` |

## План

Поля и enum'ы — в схеме. Пример — `schema/plan.example.json`.

`parallel_group`: меньшее раньше, одинаковое можно параллельно. `depends_on` — id задач, не номера GitHub issue.
