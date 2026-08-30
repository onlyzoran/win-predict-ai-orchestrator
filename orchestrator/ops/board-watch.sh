#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/cursor-workers/win-predict-ai-orchestrator
cd "$ROOT"

# Board id lives in orchestrator/products/registry.json — stale env breaks GraphQL.
unset ORCHESTRATOR_PROJECT_ID

# Prefer GITHUB_PAT; fall back to legacy ORCHESTRATOR_GITHUB_TOKEN during migration.
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
echo "board-watch rev: $(git rev-parse --short HEAD)"
grep '"id": "PVT_' orchestrator/products/registry.json || true

lock_after="$(git rev-parse HEAD:package-lock.json)"

if [[ ! -d node_modules || "$lock_before" != "$lock_after" ]]; then
  npm ci
fi

STATUS_DIR="${ORCHESTRATOR_STATUS_DIR:-/var/www/orchestrator-status}"
if [[ -d $STATUS_DIR && -f $ROOT/orchestrator/ops/status/index.html ]]; then
  cp -f "$ROOT/orchestrator/ops/status/index.html" "$STATUS_DIR/index.html"
fi

exec npm run watch
