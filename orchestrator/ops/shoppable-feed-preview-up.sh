#!/usr/bin/env bash
# Dynamic Goal preview for shoppable-feed (Next.js + API routes).
# URL: http://202.71.15.138/shoppable-feed/preview/issue-<N>/
# Usage: shoppable-feed-preview-up.sh <goal-number> [git-ref]
set -euo pipefail

GOAL="${1:?usage: shoppable-feed-preview-up.sh <goal-number> [git-ref]}"
if ! [[ "$GOAL" =~ ^[0-9]+$ ]]; then
  echo "goal-number must be digits, got: $GOAL" >&2
  exit 1
fi

REF="${2:-}"
SRC="${SHOPPABLE_FEED_PREVIEW_SRC:-/opt/cursor-workers/shoppable-feed-preview-src}"
PREVIEW_ROOT="${SHOPPABLE_FEED_PREVIEW_ROOT:-/var/www/shoppable-feed-preview}"
PREVIEW_APP="${SHOPPABLE_FEED_PREVIEW_APP:-/opt/cursor-workers/shoppable-feed-preview-run}"
REPO="${SHOPPABLE_FEED_REPO:-onlyzoran/shoppable-feed}"
SLUG="issue-${GOAL}"
BASE_PATH="/shoppable-feed/preview/${SLUG}"
TARGET="${PREVIEW_ROOT}/${SLUG}"
PREVIEW_PORT="${SHOPPABLE_FEED_PREVIEW_PORT:-3004}"

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
  if [[ $EUID -eq 0 ]]; then
    /bin/systemctl restart shoppable-feed-preview.service 2>/dev/null || /bin/systemctl enable --now shoppable-feed-preview.service
    return
  fi
  sudo -n /bin/systemctl restart shoppable-feed-preview.service 2>/dev/null || sudo -n /bin/systemctl enable --now shoppable-feed-preview.service || {
    echo "build ok — от root: systemctl restart shoppable-feed-preview.service" >&2
  }
}

exec 9>"/tmp/shoppable-feed-preview.lock"
if ! flock -w 900 9; then
  echo "preview build lock timeout (900s)" >&2
  exit 1
fi

if [[ ${SHOPPABLE_FEED_PREVIEW_IF_MISSING:-} == 1 && -f $TARGET/.preview-ready ]]; then
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

export SHOPPABLE_FEED_BASE_PATH="$BASE_PATH"
python3 - <<PY
import os
from pathlib import Path

base = os.environ["SHOPPABLE_FEED_BASE_PATH"]
Path("next.config.ts").write_text(
    f'''import type {{ NextConfig }} from "next";

const nextConfig: NextConfig = {{
  basePath: "{base}",
  trailingSlash: true,
}};

export default nextConfig;
'''
)
PY

npm ci
npm run build

mkdir -p "$PREVIEW_APP"
rsync -a --delete \
  --exclude node_modules --exclude .git \
  "$SRC/" "$PREVIEW_APP/"
cd "$PREVIEW_APP"
npm ci --omit=dev

mkdir -p "$TARGET"
echo "$REF" > "$TARGET/.preview-ref"
echo "$GOAL" > "$TARGET/.preview-ready"
echo "$GOAL" > "$PREVIEW_APP/.preview-goal"
echo "$REF" > "$PREVIEW_APP/.preview-ref"
printf 'SHOPPABLE_FEED_BASE_PATH=%s\n' "$BASE_PATH" > "$PREVIEW_APP/preview.env"

restart_preview_service

echo "preview: http://202.71.15.138${BASE_PATH}/"
