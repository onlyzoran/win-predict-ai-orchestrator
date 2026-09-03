# win-predict-ai-orchestrator

Штаб продуктов: цели, GitHub Project и оркестратор. Сейчас **active** — **win-predict-ai**, **shoppable-feed**, **gift-sales** и **ios-games**; **telegram-bots** — stub. Одна Goal на доске — несколько PR в рабочих репо.

Промпты и конфиги cloud-агентов здесь **не** хранятся — они живут в [`cursor-cloud-agents`](https://github.com/onlyzoran/cursor-cloud-agents).

## Продукты

| Продукт | Шаблон Issue | Статус |
|---|---|---|
| win-predict-ai | Issues → **win-predict-ai** | active |
| shoppable-feed | Issues → **shoppable-feed** | active |
| gift-sales | Issues → **gift-sales** | active |
| telegram-bots | Issues → **telegram-bots** | stub |
| ios-games | Issues → **ios-games** | active (template → `game-issue-<N>`) |

Реестр: [orchestrator/products/registry.json](orchestrator/products/registry.json). Фильтр на доске: лейбл продукта (`win-predict-ai`, …).

Новый Goal: репо → **Issues** → **New issue** → шаблон продукта (не «Create new issue» с доски Project). Контракт: [docs/goal-contract.md](docs/goal-contract.md).

## Рабочие репозитории (win-predict-ai)

| Репо | Роль |
|---|---|
| [`win-predict-ai-ui`](https://github.com/onlyzoran/win-predict-ai-ui) | shared Vue UI (My Machines `worker.md`) |
| [`win-predict-ai-icons`](https://github.com/onlyzoran/win-predict-ai-icons) | воркер иконок (`/new-icon`, правки через issue) |
| [`win-predict-ai-data`](https://github.com/onlyzoran/win-predict-ai-data) | воркер данных |
| [`win-predict-ai`](https://github.com/onlyzoran/win-predict-ai) | потребитель (Vue app) |
| [`win-predict-ai-admin`](https://github.com/onlyzoran/win-predict-ai-admin) | потребитель (admin) |
| [`win-predict-ai-ios`](https://github.com/onlyzoran/win-predict-ai-ios) | нативное iOS (SwiftUI, My Machines `worker.md`) |

## Рабочие репозитории (shoppable-feed)

| Репо | Роль |
|---|---|
| [`shoppable-feed`](https://github.com/onlyzoran/shoppable-feed) | лента товаров (единственный репо) |

Сайт: [http://202.71.15.138/shoppable-feed/](http://202.71.15.138/shoppable-feed/) (после deploy). Preview PR: `http://202.71.15.138/shoppable-feed/preview/issue-<N>/`.

## Рабочие репозитории (gift-sales)

| Репо | Роль |
|---|---|
| [`gift-sales`](https://github.com/onlyzoran/gift-sales) | продажи подарков (единственный репо) |

Сайт: [https://gift-sales.store/](https://gift-sales.store/). Preview PR: `http://202.71.15.138/gift-sales/preview/issue-<N>/`.

Goal Issues — только в этом репо (это и есть карточки на доске). PR — в таблицах выше.

Старт: карточка **Inbox → In Progress** (запасной путь — `/orchestrate`). Правки: комментарий в issue и **Review → In Progress**. Без комментария тот же переход — вотчер подтягивает `main` в PR (при конфликте — воркер MODE B). Приёмка: комментарий вроде «релизь» / «можно релизить» и **Review → In Progress** (вотчер смержит и уведёт в Done).

Секреты: [SECRETS.md](SECRETS.md) (Infisical self-hosted).

Скелет и Action: [orchestrator/](orchestrator/). Секреты приложения — в Infisical; в GitHub Secrets только `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` (см. [orchestrator/README.md](orchestrator/README.md)).

## Project

Доска: [ai-engineering-autopilot](https://github.com/users/onlyzoran/projects/3) (приватная). Общая на все продукты; фильтр по лейблу продукта.

Колонки: **Inbox** → **In Progress** → **Review** → **Done**. Карточки — только issue этого штаб-репо.

## Статус

Таймер `board-watch` на VPS раз в 2 мин видит Goal в **In Progress** и будит оркестратор. Stub-Goal → `needs_human` и Review. После PR local-ревьюер пишет вердикт в Goal; когда все куски pass/blocked — Goal в **Review**. Замечания — в Goal, карточку верни в In Progress. **Review → In Progress** без комментария — проверка/подтягивание `main` во все PR цели. Когда ок — «релизь» + **In Progress**: вотчер бампает версии, ченджлог, мержит PR и ставит **Done**.

После PR в ui/icons оркестратор публикует **prerelease** в GitHub Packages и подтягивает её в feature-PR app/admin того же Goal, чтобы интеграция шла до merge библиотеки.
