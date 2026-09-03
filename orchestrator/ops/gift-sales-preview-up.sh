#!/usr/bin/env bash
# Dynamic Goal preview for gift-sales (Next.js + API routes).
# URL: https://gift-sales.store/preview/issue-<N>/
# Usage: gift-sales-preview-up.sh <goal-number> [git-ref]
set -euo pipefail

GOAL="${1:?usage: gift-sales-preview-up.sh <goal-number> [git-ref]}"
if ! [[ "$GOAL" =~ ^[0-9]+$ ]]; then
  echo "goal-number must be digits, got: $GOAL" >&2
  exit 1
fi

REF="${2:-}"
SRC="${GIFT_SALES_PREVIEW_SRC:-/opt/cursor-workers/gift-sales-preview-src}"
PREVIEW_ROOT="${GIFT_SALES_PREVIEW_ROOT:-/var/www/gift-sales-preview}"
PREVIEW_APP="${GIFT_SALES_PREVIEW_APP:-/opt/cursor-workers/gift-sales-preview-run}"
REPO="${GIFT_SALES_REPO:-onlyzoran/gift-sales}"
SLUG="issue-${GOAL}"
BASE_PATH="/preview/${SLUG}"
TARGET="${PREVIEW_ROOT}/${SLUG}"
PREVIEW_PORT="${GIFT_SALES_PREVIEW_PORT:-3005}"

if [[ -f /etc/cursor-worker.env ]]; then
  set +u
  # shellcheck disable=SC1091
  source /etc/cursor-worker.env
  set -u
fi
GITHUB_PAT="${GITHUB_PAT:-${ORCHESTRATOR_GITHUB_TOKEN:-}}"
if [[ -n ${GITHUB_PAT} ]]; then
  export GITHUB_PAT
  export GH_TOKEN="$GITHUB_PAT"
  export GITHUB_TOKEN="${GITHUB_TOKEN:-$GITHUB_PAT}"
fi

git_auth() {
  if [[ -n "${GITHUB_PAT}" ]]; then
    basic="$(printf 'x-access-token:%s' "$GITHUB_PAT" | openssl base64 -A)"
    git -c "http.extraheader=AUTHORIZATION: basic ${basic}" "$@"
  else
    git "$@"
  fi
}

resolve_ref() {
  local ref="$1"
  if git rev-parse --verify "${ref}^{commit}" >/dev/null 2>&1; then
    git rev-parse --verify "${ref}^{commit}"
    return
  fi
  ref="${ref#origin/}"
  git rev-parse --verify "origin/${ref}^{commit}"
}

restart_preview_service() {
  # sudoers allows only /bin/systemctl restart|enable|start (not a PATH lookup).
  if [[ $EUID -eq 0 ]]; then
    /bin/systemctl restart gift-sales-preview.service 2>/dev/null || /bin/systemctl enable --now gift-sales-preview.service
    return
  fi
  sudo -n /bin/systemctl restart gift-sales-preview.service 2>/dev/null || sudo -n /bin/systemctl enable --now gift-sales-preview.service || {
    echo "build ok — от root: systemctl restart gift-sales-preview.service" >&2
  }
}

exec 9>"/tmp/gift-sales-preview.lock"
if ! flock -w 900 9; then
  echo "preview build lock timeout (900s)" >&2
  exit 1
fi

if [[ ${GIFT_SALES_PREVIEW_IF_MISSING:-} == 1 && -f $TARGET/.preview-ready ]]; then
  active_goal="$(cat "$PREVIEW_APP/.preview-goal" 2>/dev/null || true)"
  if [[ $active_goal == "$GOAL" ]]; then
    echo "preview exists: goal #$GOAL on port $PREVIEW_PORT"
    exit 0
  fi
fi

if [[ ! -d $SRC/.git ]]; then
  mkdir -p "$(dirname "$SRC")"
  git_auth clone "https://github.com/${REPO}.git" "$SRC"
fi

cd "$SRC"
git_auth fetch origin --prune --tags

if [[ -z $REF ]]; then
  GOAL_PARENT="win-predict-ai-orchestrator#${GOAL}"
  REF="$(
    gh pr list -R "$REPO" --state open --limit 50 --json body,headRefOid \
      --jq ".[] | select(.body | test(\"${GOAL_PARENT}\\\\b\")) | .headRefOid" \
      2>/dev/null | head -1 || true
  )"
  if [[ -z $REF ]]; then
    echo "no open PR for ${GOAL_PARENT}" >&2
    exit 1
  fi
fi

REF="$(resolve_ref "$REF")"
git checkout -f --detach "$REF"
git reset --hard "$REF"
git clean -fd -e node_modules -e .next

export GIFT_SALES_BASE_PATH="$BASE_PATH"
python3 - <<PY
import os
from pathlib import Path

base = os.environ["GIFT_SALES_BASE_PATH"]
Path("next.config.mjs").write_text(
    f'''/** @type {{import("next").NextConfig}} */
const nextConfig = {{
  basePath: "{base}",
  trailingSlash: true,
  transpilePackages: ["antd", "@ant-design/icons"],
  serverExternalPackages: ["better-sqlite3"],
}};

export default nextConfig;
'''
)
Path("next.config.ts").unlink(missing_ok=True)
PY

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
hash -r
/usr/bin/npm ci
/usr/bin/npm run build

mkdir -p "$PREVIEW_APP"
rsync -a --delete \
  --exclude node_modules --exclude .git \
  "$SRC/" "$PREVIEW_APP/"
cd "$PREVIEW_APP"
/usr/bin/npm ci --omit=dev

mkdir -p "$TARGET"
echo "$REF" > "$TARGET/.preview-ref"
echo "$GOAL" > "$TARGET/.preview-ready"
echo "$GOAL" > "$PREVIEW_APP/.preview-goal"
echo "$REF" > "$PREVIEW_APP/.preview-ref"
printf 'GIFT_SALES_BASE_PATH=%s\n' "$BASE_PATH" > "$PREVIEW_APP/preview.env"

restart_preview_service

echo "preview: https://gift-sales.store${BASE_PATH}/"
