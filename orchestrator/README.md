# Оркестратор

Менеджер читает Goal Issue и возвращает JSON-план. Диспетчер создаёт child issues и запускает воркеров.

```
orchestrator/
  prompts/manager.md
  prompts/worker.md          # исполнитель ui/app/admin/data на My Machines
  prompts/reviewer.md        # local: вердикт по PR до колонки Review
  schema/plan.schema.json
  schema/plan.example.json
  schema/review.schema.json
  src/run.ts
  ops/cursor-worker.service  # systemd: My Machines worker
  ops/board-watch.timer      # systemd: In Progress + Ready to Release
  prompts/design.md          # вкус и палитра для ui/app/admin
```

## `/orchestrate` и доска

Комментарий `/orchestrate` на Goal Issue (лейбл `goal`) — запасной старт. Основной жест: карточка на доске.

1. Goal **Inbox → In Progress** (или `/orchestrate`): local-агент на GitHub runner собирает план, child issues, Goal → **In Progress**, воркеры.
2. Диспетчер:
   - `slash` `/new-icon` → комментарий, **ждёт PR**
   - `ui` / `sdk` → My Machines `win-predict-vps` (`worker.md`)
3. После PR local-ревьюер (`reviewer.md`): **pass** / **blocked** → child **Review**; **changes** → child остаётся **In Progress**, воркер MODE B (макс. 2 круга, потом blocked). Goal → **Review**, когда все child pass или blocked.
4. Приёмка: человек **Review → Ready to Release**. Вотчер: ченджлог (если есть) → `gh pr merge --squash` → **Done**. Goal в Ready to Release релизит оставшиеся open child.
5. Правка: комментарий в **issue** (не в PR) и карточка **Review → In Progress**. Таймер `board-watch` на `win-predict-vps` (каждые 2 мин) поднимает Goal → оркестратор или child → воркер MODE B (та же ветка PR). Иконки (`/new-icon`) на VPS не едут: выбор A–D — комментарий в PR. Если VPS молчит — `systemctl start board-watch.service`.

Если план уже есть, повторный `/orchestrate` только догоняет воркеров (не плодит issues). С нуля: `/orchestrate redo`. Ошибка старта воркера **не** ставит `DISPATCH_MARKER` на Goal — `/orchestrate` или возврат в In Progress можно повторить.

## Секреты репо

| Secret | Зачем |
|---|---|
| `CURSOR_API_KEY` | персональный user key; менеджер и ревьюер (local) и воркеры (My Machines). Тот же ключ / тот же Cursor-аккаунт, что у `agent worker start` на VPS |
| `ORCHESTRATOR_GITHUB_TOKEN` | PAT: `repo` + `project`; в сессии воркера как `$GH_TOKEN` |
| `TELEGRAM_BOT_TOKEN` | бот для коротких событий (не сырой лог, не каждый тик таймера) |
| `TELEGRAM_CHAT_ID` | чат, куда писать |

`CURSOR_MACHINE_NAME` в Action = `win-predict-vps` (не секрет).

## My Machines на VPS

Не Cursor-hosted VM и не Self-Hosted Pool (`--pool`). Worker-процесс на VPS, модель в Cursor.

- Клоны: `/opt/cursor-workers/{win-predict-ai,win-predict-ai-admin,win-predict-ai-data,win-predict-ai-ui,win-predict-ai-orchestrator}`
- Прод админки `/var/www/win-predict-ai-admin` не монтировать в `--worker-dir`
- Юниты: `cursor-worker.service`, `board-watch.timer` — см. [ops/README.md](ops/README.md)
- Инвентарь слота: `/opt/cursor-workers/data/inventory.json` (снимок в Telegram при старте/квоте/финише)
- Живой UI слота: `http://<vps>/ops/` (см. [ops/README.md](ops/README.md#статус-ui))
- Проверка: `agent worker debug`, `systemctl list-timers board-watch.timer`, машина в [cursor.com/agents](https://cursor.com/agents)

## Модули

| Модуль | Сейчас |
|---|---|
| decompose | local `Agent.prompt` |
| dispatch | issues + slash `/new-icon` или My Machines `worker.md` |
| review | local `Agent.prompt` (`reviewer.md`) по PR; pass/blocked → Review, changes → воркер MODE B |
| watch | systemd timer на VPS: In Progress после Review → оркестратор/воркер; Ready to Release → ченджлог + merge → Done |
