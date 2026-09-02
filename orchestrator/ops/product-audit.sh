#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/cursor-workers/win-predict-ai-orchestrator
cd "$ROOT"

unset ORCHESTRATOR_PROJECT_ID

GITHUB_PAT="${GITHUB_PAT:-${ORCHESTRATOR_GITHUB_TOKEN:-}}"
if [[ -n "${GITHUB_PAT}" ]]; then
  export GITHUB_PAT
  export GH_TOKEN="$GITHUB_PAT"
  export GITHUB_TOKEN="${GITHUB_TOKEN:-$GITHUB_PAT}"
fi

lock_before="$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)"
if [[ -n "${GITHUB_PAT}" ]]; then
  basic="$(printf 'x-access-token:%s' "$GITHUB_PAT" | openssl base64 -A)"
  git -c "http.extraheader=AUTHORIZATION: basic ${basic}" fetch origin
else
  git fetch origin
fi
git reset --hard origin/main
echo "product-audit rev: $(git rev-parse --short HEAD)"

lock_after="$(git rev-parse HEAD:package-lock.json)"

if [[ ! -d node_modules || "$lock_before" != "$lock_after" ]]; then
  npm ci
fi

PRODUCT="${1:-win-predict-ai}"
exec npm run audit -- "$PRODUCT"
