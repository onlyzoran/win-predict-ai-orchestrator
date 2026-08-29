# Win Predict HQ

Внешний pitch-лендинг: **https://hq.win-predict-ai.com**

Одна страница на русском: цикл Inbox → Done, роли, сценарий. Без ops-деталей.

## Деплой (root на VPS)

После того как этот репо на `origin/main` и клон на VPS актуален:

```bash
chmod +x /opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/install-hq.sh
/opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/install-hq.sh
```

Дальше по выводу скрипта: DNS → `sites-enabled` → `certbot --nginx -d hq.win-predict-ai.com`.

Файлы:

| Путь | Назначение |
|---|---|
| `ops/hq/index.html` | страница |
| `ops/hq.nginx.conf.example` | vhost |
| `/var/www/orchestrator-hq` | копия на VPS |

Обновление после правок HTML: снова `install-hq.sh` или копирование `index.html` в `/var/www/orchestrator-hq/`.
