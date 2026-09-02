#!/usr/bin/env bash
# Prod deploy shoppable-feed: http://202.71.15.138/shoppable-feed/
# Usage: shoppable-feed-deploy.sh [git-ref]
set -euo pipefail

REF="${1:-}"
APP="${SHOPPABLE_FEED_APP:-/opt/cursor-workers/shoppable-feed}"

if [[ -f /etc/cursor-worker.env ]]; then
  set +u
  # shellcheck disable=SC1091
  source /etc/cursor-worker.env
  set -u
fi

cd "$APP"

if [[ -n $REF ]]; then
  GITHUB_PAT="${GITHUB_PAT:-${ORCHESTRATOR_GITHUB_TOKEN:-}}"
  git_auth() {
    if [[ -n "${GITHUB_PAT}" ]]; then
      basic="$(printf 'x-access-token:%s' "$GITHUB_PAT" | openssl base64 -A)"
      git -c "http.extraheader=AUTHORIZATION: basic ${basic}" "$@"
    else
      git "$@"
    fi
  }
  git_auth fetch origin --prune
  git checkout --detach "$REF"
  git reset --hard "$REF"
  git clean -fd -e node_modules -e .next
fi

python3 - <<'PY'
from pathlib import Path
Path("next.config.ts").write_text(
    """import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/shoppable-feed",
  trailingSlash: true,
};

export default nextConfig;
"""
)
PY

npm ci
npm run build

if systemctl is-active --quiet shoppable-feed.service 2>/dev/null; then
  systemctl restart shoppable-feed.service
elif [[ $EUID -eq 0 ]]; then
  systemctl enable --now shoppable-feed.service
else
  echo "build ok — от root: systemctl enable --now shoppable-feed.service" >&2
fi

echo "prod: http://202.71.15.138/shoppable-feed/"
