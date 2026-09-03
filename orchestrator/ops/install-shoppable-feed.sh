#!/usr/bin/env bash
set -euo pipefail

# Один раз от root на VPS после первого deploy Next.js в shoppable-feed.
# Прод:  http://202.71.15.138/shoppable-feed/
# Demo:  http://202.71.15.138/shoppable-feed/preview/issue-<N>/

ROOT=/opt/cursor-workers/win-predict-ai-orchestrator
SNIPPET=/etc/nginx/snippets/shoppable-feed.conf
IP_SITE=/etc/nginx/sites-available/gift-sales-ip
IP_SSL_SITE=/etc/nginx/sites-available/gift-sales-ip-ssl
PREVIEW_ROOT=/var/www/shoppable-feed-preview
UNIT=/etc/systemd/system/shoppable-feed.service
PREVIEW_UNIT=/etc/systemd/system/shoppable-feed-preview.service
PREVIEW_APP=/opt/cursor-workers/shoppable-feed-preview-run

if [[ $EUID -ne 0 ]]; then
  echo "запусти от root" >&2
  exit 1
fi

install -d -o cursor-worker -g www-data -m 2755 "$PREVIEW_ROOT"
install -d -o cursor-worker -g cursor-worker "$PREVIEW_APP"
install -m 644 "$ROOT/orchestrator/ops/shoppable-feed.nginx.conf" "$SNIPPET"
install -m 644 "$ROOT/orchestrator/ops/shoppable-feed.service.example" "$UNIT"
install -m 644 "$ROOT/orchestrator/ops/shoppable-feed-preview.service.example" "$PREVIEW_UNIT"
chmod +x "$ROOT/orchestrator/ops/shoppable-feed-preview-up.sh"
chmod +x "$ROOT/orchestrator/ops/shoppable-feed-deploy.sh"

SUDOERS=/etc/sudoers.d/cursor-worker-shoppable-feed-preview
cat > "$SUDOERS" <<'EOF'
cursor-worker ALL=(ALL) NOPASSWD: /bin/systemctl restart shoppable-feed-preview.service, /bin/systemctl enable shoppable-feed-preview.service, /bin/systemctl start shoppable-feed-preview.service
EOF
chmod 440 "$SUDOERS"

if [[ -f $IP_SITE ]] && ! grep -q 'snippets/shoppable-feed.conf' "$IP_SITE"; then
  sed -i '/include \/etc\/nginx\/snippets\/gift-sales.conf;/a\
    include /etc/nginx/snippets/shoppable-feed.conf;' "$IP_SITE"
fi

if [[ -f $IP_SSL_SITE ]] && ! grep -q 'snippets/shoppable-feed.conf' "$IP_SSL_SITE"; then
  sed -i '/include \/etc\/nginx\/snippets\/gift-sales.conf;/a\
    include /etc/nginx/snippets/shoppable-feed.conf;' "$IP_SSL_SITE"
fi

echo "Nginx snippet: $SNIPPET"
echo "Preview root:  $PREVIEW_ROOT (markers)"
echo "Preview app:   $PREVIEW_APP (dynamic, PORT=3004)"
echo "Systemd unit:  $UNIT (PORT=3003)"
echo "Preview unit:  $PREVIEW_UNIT"
echo "Sudoers:       $SUDOERS"
echo
echo "Проверка: nginx -t && systemctl reload nginx"
echo "URL: http://202.71.15.138/shoppable-feed/"
echo
echo "Deploy:"
echo "    $ROOT/orchestrator/ops/shoppable-feed-deploy.sh [git-ref]"
