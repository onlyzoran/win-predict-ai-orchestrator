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

Лейбл `goal` ставит шаблон. Лейблы поверхностей (`ui`, `icons`, `data`, `app`, `admin`) оркестратор допишет после плана; вручную можно сразу.

Старт: карточка Goal **Inbox → In Progress** (или комментарий `/orchestrate`). Повтор с новыми child issues: `/orchestrate redo`.

Правки после Review: комментарий **в issue** (Goal или child) и карточка **Review → In Progress**. Комментарий без смены колонки — только заметка, агент не стартует.

## Лейблы

| Лейбл | Где | Смысл |
|---|---|---|
| `goal` | только этот репо | это цель, не child |
| `ui` | Goal и child | `win-predict-ai-ui` |
| `icons` | Goal и child | `win-predict-ai-icons` |
| `data` | Goal и child | `win-predict-ai-data` |
| `app` | Goal и child | `win-predict-ai` |
| `admin` | Goal и child | `win-predict-ai-admin` |

## Колонки Project

Доска: [win-predict-ai](https://github.com/users/onlyzoran/projects/3).

| Колонка | Кто двигает | Значение |
|---|---|---|
| Inbox | человек | цель записана, оркестратор ещё не брал |
| In Progress | человек или оркестратор | человек просит работу (первый раз или правка); оркестратор/воркер исполняет |
| Review | оркестратор | PR прошёл ревьюера (pass/blocked) или ревьюер исчерпал правки. Замечания — в issue, карточку верни в In Progress. Merge сам |
| Done | человек | критерий готовности выполнен, PR смержен |

Черновики и идеи без шаблона в Project не кладём.

## Child issues

Одно child issue — один рабочий репо. Диспетчер после плана запускает воркера: My Machines `worker.md` (ui/app/admin/data) или slash `/new-icon`. Затем local-ревьюер читает PR и пишет вердикт в **issue**: pass/blocked → Review, changes → снова воркер. Правки человека — issue + колонка In Progress, не комментарий в PR.

Как режется цель: [orchestrator/prompts/manager.md](../orchestrator/prompts/manager.md). Форма плана: [orchestrator/schema/plan.schema.json](../orchestrator/schema/plan.schema.json).
