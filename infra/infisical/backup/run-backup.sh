#!/usr/bin/env bash
# Dump Infisical Postgres and upload to S3-compatible storage.
# Config: /etc/infisical/backup.env (see backup.env.example). Never print secrets.
set -euo pipefail

ENV_FILE="${INFISICAL_BACKUP_ENV:-/etc/infisical/backup.env}"
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${S3_BUCKET:?}"
: "${S3_ENDPOINT:?}"
: "${AWS_ACCESS_KEY_ID:?}"
: "${AWS_SECRET_ACCESS_KEY:?}"
: "${AWS_DEFAULT_REGION:=auto}"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOCAL_DIR="${BACKUP_LOCAL_DIR:-/var/backups/infisical}"
mkdir -p "$LOCAL_DIR"
FILE="infisical_${STAMP}.sql.gz"
PATH_LOCAL="${LOCAL_DIR}/${FILE}"

docker exec infisical-db pg_dump -U infisical -d infisical --no-owner --no-acl \
  | gzip -c > "$PATH_LOCAL"

aws s3 cp "$PATH_LOCAL" "s3://${S3_BUCKET}/infisical/${FILE}" \
  --endpoint-url "$S3_ENDPOINT"

# Keep a few local copies only (off-box is primary)
KEEP_LOCAL="${BACKUP_KEEP_LOCAL:-3}"
ls -1t "$LOCAL_DIR"/infisical_*.sql.gz 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))" | xargs -r rm -f

echo "backup_ok file=${FILE}"
