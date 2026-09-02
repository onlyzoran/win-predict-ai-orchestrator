#!/usr/bin/env bash
# Static Goal preview for gift-sales: /var/www/gift-sales-preview/issue-<N>/
# Usage (cursor-worker on VPS): gift-sales-preview-up.sh <goal-number> [git-ref]
set -euo pipefail

GOAL="${1:?usage: gift-sales-preview-up.sh <goal-number> [git-ref]}"
if ! [[ "$GOAL" =~ ^[0-9]+$ ]]; then
  echo "goal-number must be digits, got: $GOAL" >&2
  exit 1
fi

REF="${2:-}"
SRC="${GIFT_SALES_PREVIEW_SRC:-/opt/cursor-workers/gift-sales-preview-src}"
PREVIEW_ROOT="${GIFT_SALES_PREVIEW_ROOT:-/var/www/gift-sales-preview}"
REPO="${GIFT_SALES_REPO:-onlyzoran/gift-sales}"
SLUG="issue-${GOAL}"
BASE_PATH="/gift-sales/preview/${SLUG}"
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

const exportPreview = process.env.GIFT_SALES_OUTPUT === "export";

const nextConfig: NextConfig = {
  basePath: process.env.GIFT_SALES_BASE_PATH || "/gift-sales",
  trailingSlash: true,
  transpilePackages: ["antd", "@ant-design/icons"],
  ...(exportPreview ? { output: "export" as const, images: { unoptimized: true } } : {}),
};

export default nextConfig;
"""
)
PY

npm ci
GIFT_SALES_BASE_PATH="$BASE_PATH" GIFT_SALES_OUTPUT=export npm run build

if [[ ! -d out ]]; then
  echo "next export did not produce out/" >&2
  exit 1
fi

mkdir -p "$TARGET"
rsync -a --delete out/ "$TARGET/"
echo "preview: http://202.71.15.138${BASE_PATH}/"
