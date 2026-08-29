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
| [`win-predict-ai-ios`](https://github.com/onlyzoran/win-predict-ai-ios) | нативное iOS (SwiftUI, My Machines `worker.md`) |

Goal Issues — в этом репо. Child issues — в таблице выше.

Контракт цели: [docs/goal-contract.md](docs/goal-contract.md). Новый Goal — шаблон **Goal**. Старт: карточка **Inbox → In Progress** (запасной путь — `/orchestrate`). Правки: комментарий в issue и **Review → In Progress**. Без комментария тот же переход — вотчер подтягивает `main` в PR (при конфликте — воркер MODE B). Приёмка: комментарий вроде «релизь» / «можно релизить» и **Review → In Progress** (вотчер смержит и уведёт в Done).

Скелет и Action: [orchestrator/](orchestrator/). Секреты приложения — в Infisical; в GitHub Secrets только `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` (см. [orchestrator/README.md](orchestrator/README.md)).

## Project

Доска: [win-predict-ai](https://github.com/users/onlyzoran/projects/3) (приватная).

Колонки: **Inbox** → **In Progress** → **Review** → **Done**. Привязана к этому репо и шести рабочим.

## Статус

Таймер `board-watch` на VPS раз в 2 мин видит карточки **In Progress** и будит оркестратор (Goal) или воркера (child — в т.ч. ручной issue в рабочем репо без Goal). После PR local-ревьюер либо оставляет child в In Progress (правки), либо двигает в **Review**. Замечания пиши в issue и верни карточку в In Progress. **Review → In Progress** без комментария — проверка/подтягивание `main` в PR; конфликт → MODE B, иначе снова Review. Когда ок — напиши «релизь» (или «можно релизить» / «отправляем на релиз») и перенеси в **In Progress**: вотчер поднимет версию, обновит ченджлог, смержит PR и поставит **Done**.

После PR в ui/icons оркестратор публикует **prerelease** в GitHub Packages и подтягивает её в feature-PR app/admin того же Goal, чтобы интеграция шла до merge библиотеки.