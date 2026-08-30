# Контракт Goal Issue

Goal — одна высокоуровневая цель **продукта**. Живёт в этом штаб-репо. На доске одна карточка; оркестратор открывает **несколько PR** в рабочих репо (пока active — win-predict-ai). Child issues не создаются.

## Продукты

| Шаблон | Лейбл | Статус |
|---|---|---|
| **win-predict-ai** | `win-predict-ai` | active — PR в ui/icons/data/app/admin/ios |
| **telegram-bots** | `telegram-bots` | stub — Goal на доске, PR не открываются |
| **ios-games** | `ios-games` | stub — Goal на доске, PR не открываются |

Реестр: [orchestrator/products/registry.json](../orchestrator/products/registry.json). Без лейбла продукта оркестратор считает Goal продуктом `win-predict-ai` (старые карточки). Старый префикс `product:…` тоже понимается.

На доске фильтруй по лейблу продукта. Одна Project на все продукты.

## Создание

Issues → **New issue** → выбери шаблон продукта (blank issue отключён).

Не с доски Project → Create new issue: там шаблон не подставляется. Либо:

- `…/issues/new?template=goal-win-predict-ai.yml`
- `…/issues/new?template=goal-telegram-bots.yml`
- `…/issues/new?template=goal-ios-games.yml`

Обязательно в форме:

| Поле | Зачем |
|---|---|
| Результат | Что должно быть правдой в конце |

Лейбл продукта ставит шаблон. Любой issue в этом репо — Goal (лейбл `goal` не нужен). Поверхности, ограничения и критерии готовности менеджер выводит сам из Результата.

**Stub-продукт** (bots/ios-games): Inbox → In Progress → комментарий `needs_human`, карточка в Review, PR нет.

Старт (active): карточка Goal **Inbox → In Progress** (или комментарий `/orchestrate`). С нуля: `/orchestrate redo`.

Правки после Review: комментарий **в Goal** и карточка **Review → In Progress**. Комментарий без смены колонки — только заметка, агент не стартует.

**Review → In Progress** без комментария (и без фразы про релиз): вотчер проверяет PR относительно `main` (`update-branch`). Без конфликта — карточка снова в Review; при конфликте — воркер MODE B (влить `main`, разрешить).

Приёмка: когда результат ок — комментарий вроде **«релизь»**, **«можно релизить»**, **«отправляем на релиз»** и карточка **Review → In Progress**. Вотчер **поднимет версию** в `package.json` (patch по умолчанию; `[minor]`/`[major]`/`[patch]` в заголовке PR; для ui/icons — minor при новых компонентах/иконках), запишет секцию в `CHANGELOG.md`, смержит PR и перенесёт карточку в **Done**. Если `package.json` нет (например `ios`) — только merge. Для ui/icons после merge дождётся publish этой версии и заменит prerelease-пины в открытых PR app/admin того же Goal.

## Prerelease библиотек

После PR в `win-predict-ai-ui` / `win-predict-ai-icons` оркестратор:

1. Триггерит `prerelease.yml` → версия `{base}-pr.{PR}.{sha7}` в GitHub Packages (dist-tag `pr-{PR}`)
2. Подтягивает точную версию в feature-PR `app` / `admin` того же Goal (если PR нет — открывает bump-PR)
3. На релизе библиотеки (In Progress + фраза про релиз): релизер бампает стабильную версию + CHANGELOG → merge → `release.yml` публикует уже зафиксированную версию → promote в те же consumer PR

Потребительские задачи в плане — про интеграцию, не про ручной bump.

## Лейблы

| Лейбл | Где | Смысл |
|---|---|---|
| `win-predict-ai` | Goal (этот репо) | продукт win-predict |
| `telegram-bots` | Goal | продукт bots (stub) |
| `ios-games` | Goal | продукт ios-games (stub) |

Поверхности (ui, app, admin, …) — только в плане в комментарии Goal, отдельные лейблы не ставятся.

## Колонки Project

Доска: [win-predict-ai](https://github.com/users/onlyzoran/projects/3).

| Колонка | Кто двигает | Значение |
|---|---|---|
| Inbox | человек | цель записана, оркестратор ещё не брал |
| In Progress | человек или оркестратор | человек просит работу (первый раз, правка), sync main (без комментария) или релиз (фраза «релизь» и т.п.); оркестратор/воркер/релизер исполняет |
| Review | оркестратор | PR прошёл ревьюера (pass/blocked), ревьюер исчерпал правки, или план `needs_human` / stub. Замечания — в issue + In Progress. Без комментария — sync main. Ок — «релизь» + In Progress |
| Done | оркестратор (после релиза) | PR смержен, критерий готовности выполнен |

Черновики без шаблона продукта в Project не кладём.

## PR вместо child issues

Goal — исход и приёмка (одна карточка на доске). Кусок плана — **один PR** в одном рабочем репо. В теле PR: `Parent: onlyzoran/win-predict-ai-orchestrator#N` и `<!-- orchestrator-task:id -->`. **Не** `Closes` на Goal.

После плана диспетчер запускает воркера (My Machines `worker.md` или slash `/new-icon`). Ревьюер пишет вердикт в **Goal**: pass/blocked → когда все куски готовы, Goal в Review; changes → Goal остаётся In Progress, MODE B. Правки человека — Goal + In Progress. «релизь» на Goal мержит все открытые PR плана (библиотеки раньше потребителей).

Как режется цель: [orchestrator/prompts/manager.md](../orchestrator/prompts/manager.md). Форма плана: [orchestrator/schema/plan.schema.json](../orchestrator/schema/plan.schema.json).
