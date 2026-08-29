#!/usr/bin/env bash
set -euo pipefail

# Один раз от root на VPS. Pitch: https://hq.win-predict-ai.com

ROOT=/opt/cursor-workers/win-predict-ai-orchestrator
DIR=/var/www/orchestrator-hq
SITE=/etc/nginx/sites-available/hq.win-predict-ai.com
HTML="$ROOT/orchestrator/ops/hq/index.html"
NGINX_SRC="$ROOT/orchestrator/ops/hq.nginx.conf.example"

if [[ $EUID -ne 0 ]]; then
  echo "запусти от root" >&2
  exit 1
fi
if [[ ! -f $HTML ]]; then
  echo "нет $HTML — сначала git pull в $ROOT" >&2
  exit 1
fi
if [[ ! -f $NGINX_SRC ]]; then
  echo "нет $NGINX_SRC" >&2
  exit 1
fi

install -d -o root -g www-data -m 755 "$DIR"
install -m 644 -o root -g www-data "$HTML" "$DIR/index.html"
install -m 644 "$NGINX_SRC" "$SITE"

echo "Каталог: $DIR"
echo "Nginx site: $SITE"
echo
echo "1. DNS A/AAAA: hq.win-predict-ai.com → этот VPS"
echo "2. Включить сайт (в конфиге только :80 — certbot сам добавит 443):"
echo "     ln -sf $SITE /etc/nginx/sites-enabled/hq.win-predict-ai.com"
echo "     nginx -t && systemctl reload nginx"
echo "3. TLS:"
echo "     certbot --nginx -d hq.win-predict-ai.com"
echo
echo "Обновить HTML после git pull:"
echo "     install -m 644 -o root -g www-data $HTML $DIR/index.html"
