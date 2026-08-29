# Infisical backups and healthcheck

## Backup (Postgres → S3)

1. Create an S3-compatible bucket (recommended: **Cloudflare R2**).
2. On VPS:

```bash
apt-get install -y awscli   # or ensure `aws` is on PATH
mkdir -p /opt/infisical/backup /var/backups/infisical
cp run-backup.sh /opt/infisical/backup/
chmod 755 /opt/infisical/backup/run-backup.sh
cp backup.env.example /etc/infisical/backup.env
chmod 600 /etc/infisical/backup.env
# edit /etc/infisical/backup.env with real endpoint/keys (not in chat)
cp infisical-backup.service infisical-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now infisical-backup.timer
systemctl start infisical-backup.service   # manual test once
```

## Healthcheck (email)

```bash
mkdir -p /opt/infisical/healthcheck
cp check-agent.sh /opt/infisical/healthcheck/
chmod 755 /opt/infisical/healthcheck/check-agent.sh
cp alert-smtp.env.example /etc/infisical/alert-smtp.env
chmod 600 /etc/infisical/alert-smtp.env
# edit SMTP + ALERT_TO
cp infisical-agent-healthcheck.service infisical-agent-healthcheck.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now infisical-agent-healthcheck.timer
```

Full ops narrative: [SECRETS.md](../../../SECRETS.md).
