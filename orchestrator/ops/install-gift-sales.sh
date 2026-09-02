#!/usr/bin/env bash
set -euo pipefail

# Один раз от root на VPS после первого deploy Next.js в gift-sales.
# Прод:  http://202.71.15.138/gift-sales/
# Demo:  http://202.71.15.138/gift-sales/preview/issue-<N>/

ROOT=/opt/cursor-workers/win-predict-ai-orchestrator
SNIPPET=/etc/nginx/snippets/gift-sales.conf
IP_SITE=/etc/nginx/sites-available/gift-sales-ip
PREVIEW_ROOT=/var/www/gift-sales-preview
UNIT=/etc/systemd/system/gift-sales.service
ADMIN_SITE=/etc/nginx/sites-enabled/win-predict-ai-admin

if [[ $EUID -ne 0 ]]; then
  echo "запусти от root" >&2
  exit 1
fi

install -d -o cursor-worker -g www-data -m 2755 "$PREVIEW_ROOT"
install -m 644 "$ROOT/orchestrator/ops/gift-sales.nginx.conf" "$SNIPPET"
install -m 644 "$ROOT/orchestrator/ops/gift-sales-ip.nginx.conf" "$IP_SITE"
install -m 644 "$ROOT/orchestrator/ops/gift-sales.service.example" "$UNIT"
ln -sf "$IP_SITE" /etc/nginx/sites-enabled/gift-sales-ip

if [[ -f $ADMIN_SITE ]] && ! grep -q 'snippets/gift-sales.conf' "$ADMIN_SITE"; then
  sed -i '/location \^~ \/ops\//,/^[[:space:]]*}/{
    /^[[:space:]]*}/a\
\
    include /etc/nginx/snippets/gift-sales.conf;
  }' "$ADMIN_SITE"
fi

echo "Nginx snippet: $SNIPPET"
echo "HTTP IP site:  $IP_SITE → sites-enabled/gift-sales-ip"
echo "Preview root:  $PREVIEW_ROOT"
echo "Systemd unit:  $UNIT (PORT=3002)"
echo
echo "Проверка: nginx -t && systemctl reload nginx"
echo "URL: http://202.71.15.138/gift-sales/ и https://202.71.15.138/gift-sales/"
echo
echo "После npm run build в /opt/cursor-workers/gift-sales (basePath /gift-sales):"
echo "    systemctl daemon-reload && systemctl enable --now gift-sales.service"
