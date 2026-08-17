#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/cursor-workers/win-predict-ai-orchestrator
cd "$ROOT"

if [[ -n "${ORCHESTRATOR_GITHUB_TOKEN:-}" ]]; then
  export GH_TOKEN="$ORCHESTRATOR_GITHUB_TOKEN"
  export GITHUB_TOKEN="${GITHUB_TOKEN:-$ORCHESTRATOR_GITHUB_TOKEN}"
fi

lock_before="$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)"
if [[ -n "${ORCHESTRATOR_GITHUB_TOKEN:-}" ]]; then
  basic="$(printf 'x-access-token:%s' "$ORCHESTRATOR_GITHUB_TOKEN" | openssl base64 -A)"
  git -c "http.extraheader=AUTHORIZATION: basic ${basic}" fetch origin
else
  git fetch origin
fi
git reset --hard origin/main
lock_after="$(git rev-parse HEAD:package-lock.json)"

if [[ ! -d node_modules || "$lock_before" != "$lock_after" ]]; then
  npm ci
fi

exec npm run watch
