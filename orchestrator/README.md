# Оркестратор

Менеджер читает Goal Issue и возвращает JSON-план. Диспетчер запускает воркеров; PR линкуют Goal (без child issues).

```
orchestrator/
  products/registry.json     # продукты: active surfaces / stub
  prompts/manager.md
  prompts/worker.md          # исполнитель ui/app/admin/data/ios на My Machines
  prompts/reviewer.md        # local: вердикт по PR до колонки Review
  schema/plan.schema.json
  schema/plan.example.json
  schema/review.schema.json
  src/run.ts
  src/products.ts            # лейбл продукта → registry
  ops/cursor-worker.service  # systemd: My Machines worker
  ops/board-watch.timer      # systemd: In Progress (работа + релиз по фразе)
  prompts/design.md          # вкус и палитра для ui/app/admin
```

## `/orchestrate` и доска

Комментарий `/orchestrate` на issue в этом репо (штаб = Goal) — запасной старт. Основной жест: карточка на доске.

1. Goal **Inbox → In Progress** (или `/orchestrate`): план, воркеры, PR к Goal.
2. Диспетчер:
   - `slash` `/new-icon` → комментарий в icons-репо (не на доске), **ждёт PR**, дописывает Parent + маркер
   - `sdk` → My Machines `win-predict-vps` (`worker.md`)
3. После PR local-ревьюер (`reviewer.md`) пишет в **Goal**: **pass** / **blocked**; **changes** → Goal остаётся **In Progress**, воркер MODE B (макс. 2 круга). Goal → **Review**, когда все куски плана готовы.
4. Приёмка: «релизь» и **Review → In Progress**. Вотчер мержит все open PR плана → **Done**.
5. **Review → In Progress** без комментария: sync `main` во все PR. Правка: комментарий в **Goal**. Таймер `board-watch` каждые 2 мин.

Если план уже есть, повторный `/orchestrate` догоняет воркеров. С нуля: `/orchestrate redo`.

## Секреты репо

Боевые секреты оркестратора живут в Infisical (Production). GitHub Actions тянет их через
[`Infisical/secrets-action`](https://github.com/Infisical/secrets-action) и identity `ci-github-actions`.

| Secret (GitHub) | Зачем |
|---|---|
| `INFISICAL_CLIENT_ID` | Universal Auth Client ID для `ci-github-actions` |
| `INFISICAL_CLIENT_SECRET` | Universal Auth Client Secret для `ci-github-actions` |

В Infisical (Production) должны быть: `CURSOR_API_KEY`, `GITHUB_PAT`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

`CURSOR_MACHINE_NAME` в Action = `win-predict-vps` (не секрет). `GITHUB_TOKEN` выдаёт сам Actions.

## My Machines на VPS

Не Cursor-hosted VM и не Self-Hosted Pool (`--pool`). Worker-процесс на VPS, модель в Cursor.

- Клоны: `/opt/cursor-workers/{win-predict-ai,win-predict-ai-admin,win-predict-ai-data,win-predict-ai-ui,win-predict-ai-ios,shoppable-feed,win-predict-ai-orchestrator}`
- Прод админки `/var/www/win-predict-ai-admin` не монтировать в `--worker-dir`
- Юниты: `cursor-worker.service`, `board-watch.timer` — см. [ops/README.md](ops/README.md)
- Инвентарь слота: `/opt/cursor-workers/data/inventory.json` (снимок в Telegram при старте/квоте/финише)
- Живой UI слота: `http://<vps>/ops/` (см. [ops/README.md](ops/README.md#статус-ui))
- Проверка: `agent worker debug`, `systemctl list-timers board-watch.timer`, машина в [cursor.com/agents](https://cursor.com/agents)
- `win-predict-ai-ios`: на VPS нет Xcode — воркер правит исходники и открывает PR; сборка/симулятор на машине человека

## Модули

| Модуль | Сейчас |
|---|---|
| decompose | local `Agent.prompt` |
| dispatch | issues + slash `/new-icon` или My Machines `worker.md` |
| review | local `Agent.prompt` (`reviewer.md`) по PR; pass/blocked → Review, changes → воркер MODE B |
| watch | systemd timer на VPS: In Progress → оркестратор/воркер; после PR ui/icons → prerelease + bump app/admin; In Progress + фраза про релиз → bump версии + ченджлог + merge (+ publish/promote для библиотек) → Done |
