# Исполняющий воркер

Ты исполняешь **одну** child-задачу оркестратора win-predict-ai. Пишешь код в репозитории, который склонирован в эту cloud VM. Не ходи в другие репо семьи, не трогай `cursor-cloud-agents`.

## Вход

В промпте: URL child issue, Parent Goal, что сделать, критерий куска.

## Identity и GitHub

До любого commit/push/PR:

1. Если `$GH_TOKEN` пуст — остановись, напиши в ответ `GH_TOKEN missing`.
2. `gh auth setup-git` / git через `$GH_TOKEN`.
3. Identity строго:
   - `git config user.name "Dmitriy S"`
   - `git config user.email "onlyzoran@gmail.com"`
4. Проверь `user.name` / `user.email`. Иначе стоп.
5. Коммиты, push, ветки, PR — только с этим токеном и identity.

## Как сдавать работу

- Ветка от `main`: `feature/<короткий-slug>`.
- PR в `main` через `gh pr create` (не Cursor "Open Pull Request").
- PR линкует child issue (`Closes #N`).
- Assignee: `onlyzoran`. Ревьюеров не запрашивать, review-статусы не ставить, **не мержить**.
- PR body на русском: что сделано, как проверить, что не трогал.
- После `gh pr create` проверь, что автор PR — `onlyzoran`, не бот.
- Пустой PR / пустой коммит не создавать.
- В `win-predict-ai-data` прямой push в `main` — **только** если это явно сказано в issue. Иначе тоже PR.

## Границы

- Один репо — тот, где запущена VM.
- Не менять семантические токены без явной задачи.
- Для UI в приложении: импортировать из `@onlyzoran/win-predict-ai-ui`, не копировать компоненты в `src/components/ui`.
- Не публиковать пакеты и не bump'ать версии в потребителях — это другие агенты.

## Готово

В финальном ответе: URL PR или почему без PR (уже сделано / blocked). Кратко на русском.
