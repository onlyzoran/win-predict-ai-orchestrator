# Контракт Goal Issue

Goal — одна высокоуровневая цель. Живёт только в этом репо. Child issues оркестратор создаёт в рабочих репозиториях.

## Создание

Новый Goal: шаблон **Goal** (`.github/ISSUE_TEMPLATE/goal.yml`).

Обязательно:

| Поле | Зачем |
|---|---|
| Результат | Что должно быть правдой в конце |
| Критерий готовности | Когда карточку можно двигать в Done |
| Поверхности | Подсказка, какие репо затронуть |

Лейбл `goal` ставит шаблон. Лейблы поверхностей (`ui`, `icons`, `data`, `app`, `admin`, `ios`) оркестратор допишет после плана; вручную можно сразу.

Старт: карточка Goal **Inbox → In Progress** (или комментарий `/orchestrate`). Повтор с новыми child issues: `/orchestrate redo`.

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
| Review | оркестратор | PR прошёл ревьюера (pass/blocked) или ревьюер исчерпал правки. Замечания — в issue + In Progress. Без комментария — sync main. Ок — «релизь» + In Progress |
| Done | оркестратор (после релиза) | PR смержен, критерий готовности выполнен |

Черновики и идеи без шаблона в Project не кладём.

## Child issues

Goal — исход и приёмка. Child — **mergeable** кусок в одном рабочем репо (по умолчанию одна поверхность = одно child). Несколько child в одном репо — только если куски независимо релизятся; иначе один PR. Пример «кнопка везде»: Goal + ui → app/admin (после prerelease) → ios при необходимости — не дробить ui на стили/story отдельно.

Одно child issue — один `id` в плане. Диспетчер не схлопывает задачи в одну карточку. После плана запускает воркера: My Machines `worker.md` (ui/app/admin/data/ios) или slash `/new-icon`. Затем local-ревьюер читает PR и пишет вердикт в **issue**: pass/blocked → Review, changes → снова воркер. Правки человека — issue + колонка In Progress, не комментарий в PR. Закрытый child (смерженный кусок) считается готовым: его не переоткрывают и не блокируют им следующие задачи. После Done зависимости оркестратор сам поднимает следующие child с выполненным `depends_on` (Inbox → In Progress + воркер); в одном репо цепочка ждёт merge, между репо достаточно PR у пакета.

Как режется цель: [orchestrator/prompts/manager.md](../orchestrator/prompts/manager.md). Форма плана: [orchestrator/schema/plan.schema.json](../orchestrator/schema/plan.schema.json).
