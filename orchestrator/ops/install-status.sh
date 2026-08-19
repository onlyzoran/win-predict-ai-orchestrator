#!/usr/bin/env bash
set -euo pipefail

# Один раз от root на VPS. UI: http://202.71.15.138/ops/

ROOT=/opt/cursor-workers/win-predict-ai-orchestrator
DIR=/var/www/orchestrator-status
SNIPPET=/etc/nginx/snippets/orchestrator-status.conf
PORT_SITE=/etc/nginx/sites-available/orchestrator-status
HTML="$ROOT/orchestrator/ops/status/index.html"

if [[ $EUID -ne 0 ]]; then
  echo "запусти от root" >&2
  exit 1
fi
if [[ ! -f $HTML ]]; then
  echo "нет $HTML — сначала git pull в $ROOT" >&2
  exit 1
fi

install -d -o cursor-worker -g www-data -m 2755 "$DIR"
install -m 644 -o cursor-worker -g www-data "$HTML" "$DIR/index.html"
if [[ ! -f $DIR/inventory.json ]]; then
  cat > "$DIR/inventory.json" <<'EOF'
{"machine":"win-predict-vps","slots":1,"updatedAt":"","active":[],"board":{"inProgress":[],"review":[]}}
EOF
  chown cursor-worker:www-data "$DIR/inventory.json"
  chmod 644 "$DIR/inventory.json"
fi

install -m 644 "$ROOT/orchestrator/ops/status.nginx.conf" "$SNIPPET"
install -m 644 "$ROOT/orchestrator/ops/status.nginx-port.conf" "$PORT_SITE"

if ! grep -q 'ORCHESTRATOR_STATUS_DIR' /etc/cursor-worker.env 2>/dev/null; then
  printf '\n# Public copy for http://202.71.15.138/ops/\nORCHESTRATOR_STATUS_DIR=%s\n' "$DIR" >> /etc/cursor-worker.env
fi

echo "Каталог: $DIR"
echo
echo "На :80 (тот же IP, путь /ops/) — в server { listen 80; } добавь:"
echo "    include $SNIPPET;"
echo "Потом: nginx -t && systemctl reload nginx"
echo
echo "Запасной URL на :8787 (не трогает Nuxt):"
echo "    ln -s $PORT_SITE /etc/nginx/sites-enabled/orchestrator-status"
echo "    ufw allow 8787/tcp   # если файрвол"
echo "    nginx -t && systemctl reload nginx"
echo "    http://202.71.15.138:8787/"
