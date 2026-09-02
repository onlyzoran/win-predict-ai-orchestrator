#!/usr/bin/env bash
set -euo pipefail

# Один раз от root на VPS после первого deploy Next.js в gift-sales.
# Прод:  http://202.71.15.138/gift-sales/
# Demo:  http://202.71.15.138/gift-sales/preview/issue-<N>/

ROOT=/opt/cursor-workers/win-predict-ai-orchestrator
SNIPPET=/etc/nginx/snippets/gift-sales.conf
PREVIEW_ROOT=/var/www/gift-sales-preview
UNIT=/etc/systemd/system/gift-sales.service

if [[ $EUID -ne 0 ]]; then
  echo "запусти от root" >&2
  exit 1
fi

install -d -o cursor-worker -g www-data -m 2755 "$PREVIEW_ROOT"
install -m 644 "$ROOT/orchestrator/ops/gift-sales.nginx.conf" "$SNIPPET"
install -m 644 "$ROOT/orchestrator/ops/gift-sales.service.example" "$UNIT"

echo "Nginx snippet: $SNIPPET"
echo "Preview root:  $PREVIEW_ROOT"
echo "Systemd unit:  $UNIT"
echo
echo "В server { listen 80; } (тот же, что /ops/) добавь:"
echo "    include $SNIPPET;"
echo "Потом: nginx -t && systemctl reload nginx"
echo
echo "После npm run build в /opt/cursor-workers/gift-sales:"
echo "    systemctl daemon-reload"
echo "    systemctl enable --now gift-sales.service"
echo
echo "Preview Goal #N: rsync/out .next/static export → $PREVIEW_ROOT/issue-N/"
