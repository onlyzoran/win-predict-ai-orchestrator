#!/usr/bin/env bash
# Prod deploy gift-sales: https://gift-sales.store/
# Usage: gift-sales-deploy.sh [git-ref]
set -euo pipefail

REF="${1:-origin/main}"
APP="${GIFT_SALES_APP:-/var/www/gift-sales}"

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
  if [[ $EUID -eq 0 ]]; then
    /bin/systemctl restart gift-sales.service 2>/dev/null || /bin/systemctl enable --now gift-sales.service
    return
  fi
  sudo -n /bin/systemctl restart gift-sales.service 2>/dev/null || sudo -n /bin/systemctl enable --now gift-sales.service || {
    echo "build ok — от root: systemctl restart gift-sales.service" >&2
  }
}

stop_service() {
  if [[ $EUID -eq 0 ]]; then
    /bin/systemctl stop gift-sales.service 2>/dev/null || true
    return
  fi
  sudo -n /bin/systemctl stop gift-sales.service 2>/dev/null || true
}

if [[ ! -d $APP/.git ]]; then
  echo "нет клона $APP — git clone https://github.com/onlyzoran/gift-sales.git $APP (прод, не worker-dir)" >&2
  exit 1
fi

# System Node only. Cursor agent ships Node 24; better-sqlite3 built with it
# crashes under systemd /usr/bin/node (22).
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
hash -r

cd "$APP"
git_auth fetch origin --prune --tags
if [[ "$REF" == origin/main || "$REF" == main ]]; then
  REF="$(git rev-parse --verify origin/main)"
fi
git checkout -f --detach "$REF"
git reset --hard "$REF"
git clean -fd -e node_modules -e .next

# Прод на корне домена. Репо по умолчанию basePath /gift-sales (для preview на IP).
python3 - <<'PY'
from pathlib import Path

cfg = Path("next.config.ts")
if cfg.exists():
    text = cfg.read_text()
    old = 'basePath: process.env.GIFT_SALES_BASE_PATH || "/gift-sales"'
    if old not in text:
        raise SystemExit("next.config.ts: не нашёл basePath для патча")
    cfg.write_text(text.replace(old, 'basePath: ""', 1))
else:
    raise SystemExit("нет next.config.ts")

paths = Path("src/lib/api/paths.ts")
if paths.exists():
    text = paths.read_text()
    old = 'export const API_BASE_PATH = "/gift-sales";'
    if old not in text:
        raise SystemExit("paths.ts: не нашёл API_BASE_PATH для патча")
    paths.write_text(text.replace(old, 'export const API_BASE_PATH = "";', 1))
PY

/usr/bin/npm ci
# next start держит .next; сборка поверх живого процесса отдаёт HTML с хешами, которых сервер ещё не видит.
stop_service
/usr/bin/npm run build
restart_service

echo "prod: https://gift-sales.store/"
