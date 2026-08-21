# win-predict-ai-orchestrator

Штаб семьи **win-predict-ai**: цели, GitHub Project и оркестратор, который режет high-level goal на задачи и назначает их рабочим репозиториям.

Промпты и конфиги cloud-агентов здесь **не** хранятся — они живут в [`cursor-cloud-agents`](https://github.com/onlyzoran/cursor-cloud-agents).

## Рабочие репозитории

| Репо | Роль |
|---|---|
| [`win-predict-ai-ui`](https://github.com/onlyzoran/win-predict-ai-ui) | shared Vue UI (My Machines `worker.md`) |
| [`win-predict-ai-icons`](https://github.com/onlyzoran/win-predict-ai-icons) | воркер иконок (`/new-icon`, правки через issue) |
| [`win-predict-ai-data`](https://github.com/onlyzoran/win-predict-ai-data) | воркер данных |
| [`win-predict-ai`](https://github.com/onlyzoran/win-predict-ai) | потребитель (Vue app) |
| [`win-predict-ai-admin`](https://github.com/onlyzoran/win-predict-ai-admin) | потребитель (admin) |

Goal Issues — в этом репо. Child issues — в таблице выше.

Контракт цели: [docs/goal-contract.md](docs/goal-contract.md). Новый Goal — шаблон **Goal**. Старт: карточка **Inbox → In Progress** (запасной путь — `/orchestrate`). Правки: комментарий в issue и **Review → In Progress**. Приёмка: **Review → Ready to Release** (вотчер смержит и уведёт в Done).

Скелет и Action: [orchestrator/](orchestrator/). Нужны секреты `CURSOR_API_KEY` и `ORCHESTRATOR_GITHUB_TOKEN` (см. [orchestrator/README.md](orchestrator/README.md)).

## Project

Доска: [win-predict-ai](https://github.com/users/onlyzoran/projects/3) (приватная).

Колонки: **Inbox** → **In Progress** → **Review** → **Ready to Release** → **Done**. Привязана к этому репо и пяти рабочим.

## Статус

Таймер `board-watch` на VPS раз в 2 мин видит карточки **In Progress** и будит оркестратор (Goal) или воркера (child). После PR local-ревьюер либо оставляет child в In Progress (правки), либо двигает в **Review**. Замечания пиши в issue и верни карточку в In Progress. Когда ок — перенеси в **Ready to Release**: вотчер обновит ченджлог, смержит PR и поставит **Done**.
