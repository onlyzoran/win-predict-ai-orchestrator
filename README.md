# win-predict-ai-orchestrator

Штаб семьи **win-predict-ai**: цели, GitHub Project и оркестратор, который режет high-level goal на задачи и назначает их рабочим репозиториям.

Промпты и конфиги cloud-агентов здесь **не** хранятся — они живут в [`cursor-cloud-agents`](https://github.com/onlyzoran/cursor-cloud-agents).

## Рабочие репозитории

| Репо | Роль |
|---|---|
| [`win-predict-ai-ui`](https://github.com/onlyzoran/win-predict-ai-ui) | воркер UI (`/ui-agent`) |
| [`win-predict-ai-icons`](https://github.com/onlyzoran/win-predict-ai-icons) | воркер иконок (`/new-icon`) |
| [`win-predict-ai-data`](https://github.com/onlyzoran/win-predict-ai-data) | воркер данных |
| [`win-predict-ai`](https://github.com/onlyzoran/win-predict-ai) | потребитель (Vue app) |
| [`win-predict-ai-admin`](https://github.com/onlyzoran/win-predict-ai-admin) | потребитель (admin) |

Goal Issues — в этом репо. Child issues — в таблице выше.

## Статус

Репозиторий только создан. Дальше по шагам: шаблон Goal Issue, колонки Project, скелет оркестратора, Action `/orchestrate`.
