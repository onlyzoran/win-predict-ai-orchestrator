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

Старт прогона: комментарий `/orchestrate` к Goal Issue.

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
| In Progress | оркестратор | есть план и/или открытые child issues / PR |
| Review | оркестратор | child-работа сделана, нужен человек (выбор, merge, приёмка) |
| Done | человек или оркестратор | критерий готовности выполнен |

Черновики и идеи без шаблона в Project не кладём.

## Child issues

Одно child issue — один рабочий репо. В теле: ссылка на Goal, что сделать, критерий готовности куска. Триггер воркера (когда дойдём до Action): `/ui-agent`, `/new-icon`, либо SDK для `data`.
