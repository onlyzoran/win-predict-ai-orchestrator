# Контракт Goal Issue

Goal — одна высокоуровневая цель **продукта**. Живёт в этом штаб-репо. Child issues оркестратор создаёт в рабочих репозиториях продукта (пока активно — только win-predict-ai).

## Продукты

| Шаблон | Лейбл | Статус |
|---|---|---|
| **win-predict-ai** | `product:win-predict-ai` | active — child в ui/icons/data/app/admin/ios |
| **telegram-bots** | `product:telegram-bots` | stub — Goal на доске, child не создаются |
| **games** | `product:games` | stub — Goal на доске, child не создаются |

Реестр: [orchestrator/products/registry.json](../orchestrator/products/registry.json). Без лейбла `product:*` оркестратор считает Goal продуктом `win-predict-ai` (старые карточки).

На доске фильтруй по `product:…`. Одна Project на все продукты.

## Создание

Issues → **New issue** → выбери шаблон продукта (blank issue отключён).

Не с доски Project → Create new issue: там шаблон не подставляется. Либо:

- `…/issues/new?template=goal-win-predict-ai.yml`
- `…/issues/new?template=goal-telegram-bots.yml`
- `…/issues/new?template=goal-games.yml`

Обязательно в форме:

| Поле | Зачем |
|---|---|
| Результат | Что должно быть правдой в конце |
| Критерий готовности | Когда карточку можно двигать в Done |
| Поверхности | Только у win-predict: подсказка, какие репо затронуть |

Лейблы `goal` и `product:…` ставит шаблон. Лейблы поверхностей (`ui`, …) оркестратор допишет после плана (win-predict).

**Stub-продукт** (bots/games): Inbox → In Progress → комментарий `needs_human`, карточка в Review, child нет. Когда появятся репо — допиши registry и повтори.

Старт (active): карточка Goal **Inbox → In Progress** (или комментарий `/orchestrate`). Повтор с новыми child: `/orchestrate redo`.

Правки после Review: комментарий **в issue** (Goal или child) и карточка **Review → In Progress**. Комментарий без смены колонки — только заметка, агент не стартует.

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
| `goal` | только этот репо | это цель, не child |
| `product:win-predict-ai` | Goal | продукт win-predict |
| `product:telegram-bots` | Goal | продукт bots (stub) |
| `product:games` | Goal | продукт games (stub) |
| `ui` | Goal и child | `win-predict-ai-ui` |
| `icons` | Goal и child | `win-predict-ai-icons` |
| `data` | Goal и child | `win-predict-ai-data` |
| `app` | Goal и child | `win-predict-ai` |
| `admin` | Goal и child | `win-predict-ai-admin` |
| `ios` | Goal и child | `win-predict-ai-ios` |

## Колонки Project

Доска: [win-predict-ai](https://github.com/users/onlyzoran/projects/3).

| Колонка | Кто двигает | Значение |
|---|---|---|
| Inbox | человек | цель записана, оркестратор ещё не брал |
| In Progress | человек или оркестратор | человек просит работу (первый раз, правка), sync main (без комментария) или релиз (фраза «релизь» и т.п.); оркестратор/воркер/релизер исполняет |
| Review | оркестратор | PR прошёл ревьюера (pass/blocked), ревьюер исчерпал правки, или план `needs_human` / stub. Замечания — в issue + In Progress. Без комментария — sync main. Ок — «релизь» + In Progress |
| Done | оркестратор (после релиза) | PR смержен, критерий готовности выполнен |

Черновики без шаблона продукта в Project не кладём.

## Child issues

Goal — исход и приёмка. Child — **mergeable** кусок в одном рабочем репо (по умолчанию одна поверхность = одно child). Несколько child в одном репо — только если куски независимо релизятся; иначе один PR. Пример «кнопка везде»: Goal + ui → app/admin (после prerelease) → ios при необходимости — не дробить ui на стили/story отдельно.

Одно child issue — один `id` в плане. Диспетчер не схлопывает задачи в одну карточку. После плана запускает воркера: My Machines `worker.md` (ui/app/admin/data/ios) или slash `/new-icon`. Затем local-ревьюер читает PR и пишет вердикт в **issue**: pass/blocked → Review, changes → снова воркер. Правки человека — issue + колонка In Progress, не комментарий в PR. Закрытый child (смерженный кусок) считается готовым: его не переоткрывают и не блокируют им следующие задачи. После Done зависимости оркестратор сам поднимает следующие child с выполненным `depends_on` (Inbox → In Progress + воркер); в одном репо цепочка ждёт merge, между репо достаточно PR у пакета.

Как режется цель: [orchestrator/prompts/manager.md](../orchestrator/prompts/manager.md). Форма плана: [orchestrator/schema/plan.schema.json](../orchestrator/schema/plan.schema.json).
