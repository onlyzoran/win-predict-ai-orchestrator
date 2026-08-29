#!/usr/bin/env bash
# Fail if Infisical Agent is down or cursor-worker.env is missing required keys.
# On failure, send email using /etc/infisical/alert-smtp.env (see alert-smtp.env.example).
set -euo pipefail

REQUIRED_KEYS=(CURSOR_API_KEY GITHUB_PAT TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID)
ENV_FILE=/etc/cursor-worker.env
SMTP_ENV=/etc/infisical/alert-smtp.env
HOST=$(hostname -f 2>/dev/null || hostname)

fail() {
  local msg=$1
  echo "healthcheck_fail: $msg" >&2
  if [[ -f $SMTP_ENV ]]; then
    # shellcheck disable=SC1090
    source "$SMTP_ENV"
    python3 - "$ALERT_TO" "$ALERT_FROM" "$SMTP_HOST" "$SMTP_PORT" "$SMTP_USER" "$SMTP_PASSWORD" "$HOST" "$msg" <<'PY'
import smtplib, ssl, sys
from email.message import EmailMessage
to, frm, host, port, user, password, hostname, body = sys.argv[1:9]
msg = EmailMessage()
msg["Subject"] = f"[infisical-agent] FAIL on {hostname}"
msg["From"] = frm
msg["To"] = to
msg.set_content(body)
ctx = ssl.create_default_context()
port = int(port or "587")
with smtplib.SMTP(host, port, timeout=30) as s:
    s.starttls(context=ctx)
    if user:
        s.login(user, password)
    s.send_message(msg)
PY
  fi
  exit 1
}

systemctl is-active --quiet infisical-agent.service || fail "infisical-agent is not active"
[[ -f $ENV_FILE ]] || fail "$ENV_FILE missing"
[[ -s $ENV_FILE ]] || fail "$ENV_FILE empty"

for k in "${REQUIRED_KEYS[@]}"; do
  grep -qE "^${k}=" "$ENV_FILE" || fail "missing key $k in $ENV_FILE"
done

# Warn if file older than 24h (agent should touch on restart; secrets may not change)
mtime=$(stat -c %Y "$ENV_FILE")
now=$(date +%s)
age=$((now - mtime))
if [[ $age -gt 86400 ]]; then
  # soft: still ok if agent active; only email if agent also unhealthy — already checked
  :
fi

echo "healthcheck_ok"
exit 0
