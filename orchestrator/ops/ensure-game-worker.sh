#!/usr/bin/env bash
# Clone a per-Goal ios-games repo on VPS and register --worker-dir in cursor-worker.service.
# Usage (root on VPS): ensure-game-worker.sh onlyzoran/game-issue-42
set -euo pipefail

REPO="${1:?onlyzoran/game-issue-N}"
NAME="${REPO#*/}"
DIR="/opt/cursor-workers/${NAME}"
SERVICE=/etc/systemd/system/cursor-worker.service

if [[ ! -f "$SERVICE" ]]; then
  echo "missing $SERVICE" >&2
  exit 1
fi

if [[ ! -d "$DIR/.git" ]]; then
  sudo -u cursor-worker git clone "https://github.com/${REPO}.git" "$DIR"
fi

if grep -qF -- "--worker-dir ${DIR}" "$SERVICE"; then
  echo "worker-dir already registered: ${DIR}"
  exit 0
fi

sed -i "s| start --verbose| --worker-dir ${DIR} start --verbose|" "$SERVICE"
systemctl daemon-reload
systemctl restart cursor-worker.service
echo "registered worker-dir ${DIR}"
