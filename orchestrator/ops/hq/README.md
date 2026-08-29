# Win Predict HQ

Интерактивные схемы на **React Flow**: https://hq.win-predict-ai.com

Вкладки: цикл цели, роли, релиз. Русский, для внешней презентации.

## Локально

```bash
cd orchestrator/ops/hq
npm install
npm run dev
```

Сборка: `npm run build` → `dist/`.

## Деплой (root на VPS)

После `git pull` в клоне оркестратора:

```bash
/opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/install-hq.sh
```

Скрипт: `npm ci && npm run build`, копирует `dist/` в `/var/www/orchestrator-hq`.  
Существующий nginx vhost (с TLS) **не перезаписывает**.

| Путь | Назначение |
|---|---|
| `ops/hq/` | Vite + React + `@xyflow/react` |
| `ops/hq.nginx.conf.example` | vhost (первый деплой) |
| `/var/www/orchestrator-hq` | статика на VPS |
