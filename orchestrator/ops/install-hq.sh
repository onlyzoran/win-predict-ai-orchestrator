#!/usr/bin/env bash
set -euo pipefail

# Deploy Win Predict HQ (React Flow) to https://hq.win-predict-ai.com
# Run as root on VPS after git pull.

ROOT=/opt/cursor-workers/win-predict-ai-orchestrator
APP="$ROOT/orchestrator/ops/hq"
DIR=/var/www/orchestrator-hq
SITE=/etc/nginx/sites-available/hq.win-predict-ai.com
NGINX_SRC="$ROOT/orchestrator/ops/hq.nginx.conf.example"

if [[ $EUID -ne 0 ]]; then
  echo "запусти от root" >&2
  exit 1
fi
if [[ ! -f $APP/package.json ]]; then
  echo "нет $APP/package.json — сначала git pull в $ROOT" >&2
  exit 1
fi

echo "Собираю HQ…"
sudo -u cursor-worker bash -lc "cd '$APP' && npm ci && npm run build"
if [[ ! -f $APP/dist/index.html ]]; then
  echo "сборка не создала dist/index.html" >&2
  exit 1
fi

install -d -o root -g www-data -m 755 "$DIR"
rsync -a --delete "$APP/dist/" "$DIR/"
chown -R root:www-data "$DIR"
find "$DIR" -type d -exec chmod 755 {} \;
find "$DIR" -type f -exec chmod 644 {} \;

if [[ ! -f $SITE ]]; then
  if [[ ! -f $NGINX_SRC ]]; then
    echo "нет $NGINX_SRC" >&2
    exit 1
  fi
  install -m 644 "$NGINX_SRC" "$SITE"
  echo "Создан $SITE (только HTTP). Дальше: sites-enabled + certbot."
else
  echo "Nginx site уже есть — не перезаписываю (чтобы не сбить TLS)."
fi

echo
echo "Каталог: $DIR"
echo "Проверка: https://hq.win-predict-ai.com"
echo
echo "Если сайта ещё нет в nginx:"
echo "  ln -sf $SITE /etc/nginx/sites-enabled/hq.win-predict-ai.com"
echo "  nginx -t && systemctl reload nginx"
echo "  certbot --nginx -d hq.win-predict-ai.com"
