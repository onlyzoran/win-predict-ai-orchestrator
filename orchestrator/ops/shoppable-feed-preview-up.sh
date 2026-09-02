#!/usr/bin/env bash
# Static Goal preview for shoppable-feed: /var/www/shoppable-feed-preview/issue-<N>/
# Usage (cursor-worker on VPS): shoppable-feed-preview-up.sh <goal-number> [git-ref]
set -euo pipefail

GOAL="${1:?usage: shoppable-feed-preview-up.sh <goal-number> [git-ref]}"
if ! [[ "$GOAL" =~ ^[0-9]+$ ]]; then
  echo "goal-number must be digits, got: $GOAL" >&2
  exit 1
fi

REF="${2:-}"
SRC="${SHOPPABLE_FEED_PREVIEW_SRC:-/opt/cursor-workers/shoppable-feed-preview-src}"
PREVIEW_ROOT="${SHOPPABLE_FEED_PREVIEW_ROOT:-/var/www/shoppable-feed-preview}"
REPO="${SHOPPABLE_FEED_REPO:-onlyzoran/shoppable-feed}"
SLUG="issue-${GOAL}"
BASE_PATH="/shoppable-feed/preview/${SLUG}"
TARGET="${PREVIEW_ROOT}/${SLUG}"

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

exec 9>"/tmp/shoppable-feed-preview.lock"
if ! flock -n 9; then
  echo "preview build already running"
  exit 0
fi

if [[ ${SHOPPABLE_FEED_PREVIEW_IF_MISSING:-} == 1 && -f $TARGET/index.html ]]; then
  echo "preview exists: $TARGET"
  exit 0
fi

if [[ ! -d $SRC/.git ]]; then
  mkdir -p "$(dirname "$SRC")"
  git_auth clone "https://github.com/${REPO}.git" "$SRC"
fi

cd "$SRC"
git_auth fetch origin --prune --tags

if [[ -z $REF ]]; then
  REF="$(
    gh pr list -R "$REPO" --state open --limit 50 --json body,headRefOid \
      --jq ".[] | select(.body | test(\"orchestrator#${GOAL}\\\\b\")) | .headRefOid" \
      2>/dev/null | head -1 || true
  )"
  if [[ -z $REF ]]; then
    REF="$(git rev-parse --verify origin/main)"
  fi
fi

git checkout --detach "$REF"
git reset --hard "$REF"
git clean -fd -e node_modules -e .next -e out

python3 - <<'PY'
from pathlib import Path
Path("next.config.ts").write_text(
    """import type { NextConfig } from "next";

const exportPreview = process.env.SHOPPABLE_FEED_OUTPUT === "export";

const nextConfig: NextConfig = {
  basePath: process.env.SHOPPABLE_FEED_BASE_PATH || "/shoppable-feed",
  trailingSlash: true,
  ...(exportPreview ? { output: "export" as const, images: { unoptimized: true } } : {}),
};

export default nextConfig;
"""
)
PY

npm ci
SHOPPABLE_FEED_BASE_PATH="$BASE_PATH" SHOPPABLE_FEED_OUTPUT=export npm run build

if [[ ! -d out ]]; then
  echo "next export did not produce out/" >&2
  exit 1
fi

mkdir -p "$TARGET"
rsync -a --delete out/ "$TARGET/"
echo "preview: http://202.71.15.138${BASE_PATH}/"
