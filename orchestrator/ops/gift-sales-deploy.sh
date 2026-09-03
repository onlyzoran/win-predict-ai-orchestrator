#!/usr/bin/env bash
# Prod deploy gift-sales: http://202.71.15.138/gift-sales/
# Usage: gift-sales-deploy.sh [git-ref]
set -euo pipefail

REF="${1:-origin/main}"
APP="${GIFT_SALES_APP:-/opt/cursor-workers/gift-sales}"

if [[ -f /etc/cursor-worker.env ]]; then
  set +u
  # shellcheck disable=SC1091
  source /etc/cursor-worker.env
  set -u
fi

GITHUB_PAT="${GITHUB_PAT:-${ORCHESTRATOR_GITHUB_TOKEN:-}}"
git_auth() {
  if [[ -n "${GITHUB_PAT}" ]]; then
    basic="$(printf 'x-access-token:%s' "$GITHUB_PAT" | openssl base64 -A)"
    git -c "http.extraheader=AUTHORIZATION: basic ${basic}" "$@"
  else
    git "$@"
  fi
}

restart_service() {
  if systemctl is-active --quiet gift-sales.service 2>/dev/null; then
    systemctl restart gift-sales.service 2>/dev/null || sudo systemctl restart gift-sales.service
  elif [[ $EUID -eq 0 ]]; then
    systemctl enable --now gift-sales.service
  else
    sudo systemctl enable --now gift-sales.service 2>/dev/null || {
      echo "build ok — от root: systemctl enable --now gift-sales.service" >&2
    }
  fi
}

if [[ ! -d $APP/.git ]]; then
  echo "нет клона $APP — git clone https://github.com/onlyzoran/gift-sales.git $APP" >&2
  exit 1
fi

cd "$APP"
git_auth fetch origin --prune --tags
if [[ "$REF" == origin/main || "$REF" == main ]]; then
  REF="$(git rev-parse --verify origin/main)"
fi
git checkout -f --detach "$REF"
git reset --hard "$REF"
git clean -fd -e node_modules -e .next

npm ci
npm run build
restart_service

echo "prod: http://202.71.15.138/gift-sales/"
