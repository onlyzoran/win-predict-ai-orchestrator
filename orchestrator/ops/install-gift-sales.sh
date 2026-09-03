#!/usr/bin/env bash
set -euo pipefail

# Один раз от root на VPS после первого deploy Next.js в gift-sales.
# Прод:  http://202.71.15.138/gift-sales/
# Demo:  http://202.71.15.138/gift-sales/preview/issue-<N>/

ROOT=/opt/cursor-workers/win-predict-ai-orchestrator
SNIPPET=/etc/nginx/snippets/gift-sales.conf
IP_SITE=/etc/nginx/sites-available/gift-sales-ip
IP_SSL_SITE=/etc/nginx/sites-available/gift-sales-ip-ssl
IP_SSL_EXAMPLE="$ROOT/orchestrator/ops/gift-sales-ip-ssl.nginx.conf.example"
PREVIEW_ROOT=/var/www/gift-sales-preview
PROD_APP=/var/www/gift-sales
UNIT=/etc/systemd/system/gift-sales.service
PREVIEW_UNIT=/etc/systemd/system/gift-sales-preview.service
PREVIEW_APP=/opt/cursor-workers/gift-sales-preview-run
ADMIN_SITE=/etc/nginx/sites-enabled/win-predict-ai-admin

if [[ $EUID -ne 0 ]]; then
  echo "запусти от root" >&2
  exit 1
fi

install -d -o cursor-worker -g www-data -m 2755 "$PREVIEW_ROOT"
install -d -o cursor-worker -g cursor-worker "$PROD_APP"
install -d -o cursor-worker -g cursor-worker "$PREVIEW_APP"
if [[ ! -d $PROD_APP/.git ]]; then
  if [[ -f /etc/cursor-worker.env ]]; then
    set +u
    # shellcheck disable=SC1091
    source /etc/cursor-worker.env
    set -u
  fi
  PAT="${GITHUB_PAT:-${ORCHESTRATOR_GITHUB_TOKEN:-}}"
  clone=(git clone https://github.com/onlyzoran/gift-sales.git "$PROD_APP")
  if [[ -n ${PAT} ]]; then
    basic="$(printf 'x-access-token:%s' "$PAT" | openssl base64 -A)"
    clone=(git -c "http.extraheader=AUTHORIZATION: basic ${basic}" clone https://github.com/onlyzoran/gift-sales.git "$PROD_APP")
  fi
  sudo -u cursor-worker "${clone[@]}"
fi
install -m 644 "$ROOT/orchestrator/ops/gift-sales.nginx.conf" "$SNIPPET"
install -m 644 "$ROOT/orchestrator/ops/gift-sales-ip.nginx.conf" "$IP_SITE"
install -m 644 "$ROOT/orchestrator/ops/gift-sales.service.example" "$UNIT"
install -m 644 "$ROOT/orchestrator/ops/gift-sales-preview.service.example" "$PREVIEW_UNIT"
chmod +x "$ROOT/orchestrator/ops/gift-sales-preview-up.sh"
chmod +x "$ROOT/orchestrator/ops/gift-sales-deploy.sh"
ln -sf "$IP_SITE" /etc/nginx/sites-enabled/gift-sales-ip

CERT_LIVE=""
for name in hq.win-predict-ai.com win-predict-ai.com secrets.win-predict-ai.com; do
  if [[ -f /etc/letsencrypt/live/$name/fullchain.pem && -f /etc/letsencrypt/live/$name/privkey.pem ]]; then
    CERT_LIVE=/etc/letsencrypt/live/$name
    break
  fi
done
if [[ -n $CERT_LIVE && -f $IP_SSL_EXAMPLE ]]; then
  sed -e "s|CERT_FULLCHAIN|$CERT_LIVE/fullchain.pem|g" -e "s|CERT_KEY|$CERT_LIVE/privkey.pem|g" \
    "$IP_SSL_EXAMPLE" > "$IP_SSL_SITE"
  chmod 644 "$IP_SSL_SITE"
  ln -sf "$IP_SSL_SITE" /etc/nginx/sites-enabled/gift-sales-ip-ssl
else
  echo "TLS default для IP не ставлю — нет let’s encrypt cert (https://IP иначе попадёт в HQ SPA)."
fi

if [[ -f $ADMIN_SITE ]] && ! grep -q 'snippets/gift-sales.conf' "$ADMIN_SITE"; then
  sed -i '/location \^~ \/ops\//,/^[[:space:]]*}/{
    /^[[:space:]]*}/a\
\
    include /etc/nginx/snippets/gift-sales.conf;
  }' "$ADMIN_SITE"
fi

echo "Nginx snippet: $SNIPPET"
echo "HTTP IP site:  $IP_SITE → sites-enabled/gift-sales-ip"
if [[ -n ${CERT_LIVE:-} ]]; then
  echo "HTTPS IP default: $IP_SSL_SITE (cert $CERT_LIVE) — чтобы не отдавать HQ SPA"
fi
echo "Prod app:      $PROD_APP (Next.js, не worker-dir)"
echo "Preview root:  $PREVIEW_ROOT (markers)"
echo "Preview app:   $PREVIEW_APP (dynamic, PORT=3005)"
echo "Systemd unit:  $UNIT (PORT=3002)"
echo "Preview unit:  $PREVIEW_UNIT"

SUDOERS=/etc/sudoers.d/cursor-worker-gift-sales-deploy
cat > "$SUDOERS" <<'EOF'
cursor-worker ALL=(ALL) NOPASSWD: /bin/systemctl restart gift-sales.service, /bin/systemctl stop gift-sales.service, /bin/systemctl enable gift-sales.service, /bin/systemctl start gift-sales.service
EOF
chmod 440 "$SUDOERS"

PREVIEW_SUDOERS=/etc/sudoers.d/cursor-worker-gift-sales-preview
cat > "$PREVIEW_SUDOERS" <<'EOF'
cursor-worker ALL=(ALL) NOPASSWD: /bin/systemctl restart gift-sales-preview.service, /bin/systemctl enable gift-sales-preview.service, /bin/systemctl start gift-sales-preview.service
EOF
chmod 440 "$PREVIEW_SUDOERS"
echo "Sudoers:       $SUDOERS (board-watch может restart gift-sales)"
echo "Preview sudo:  $PREVIEW_SUDOERS"
echo
echo "Проверка: nginx -t && systemctl reload nginx"
echo "URL: http://202.71.15.138/gift-sales/ (demo тоже HTTP; https://IP без своего имени)"
echo
echo "Прод-клон: git clone …/gift-sales.git $PROD_APP (владелец cursor-worker)."
echo "Воркер:    /opt/cursor-workers/gift-sales — не деплоить сюда."
echo "После npm run build в $PROD_APP (basePath /gift-sales):"
echo "    systemctl daemon-reload && systemctl enable --now gift-sales.service"
