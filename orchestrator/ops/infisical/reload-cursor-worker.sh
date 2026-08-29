#!/usr/bin/env bash
# Called by Infisical Agent after /etc/cursor-worker.env is rewritten.
set -euo pipefail
chown cursor-worker:cursor-worker /etc/cursor-worker.env
chmod 600 /etc/cursor-worker.env
systemctl try-restart cursor-worker.service || true
# board-watch is oneshot+timer; next tick picks EnvironmentFile automatically.
exit 0
