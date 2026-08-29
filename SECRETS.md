# Secrets management (Infisical)

Self-hosted vault: **https://secrets.win-predict-ai.com**  
VPS: `win-predict-vps` (`202.71.15.138`) · stack: `/opt/infisical`

## Where things live

| What | Where |
|------|--------|
| App secrets (`CURSOR_API_KEY`, `GITHUB_PAT`, `TELEGRAM_*`) | Infisical project **win-predict-ai**, envs **Development** + **Production** |
| Master keys `ENCRYPTION_KEY`, `AUTH_SECRET` | Password manager / offline safe **and** `/opt/infisical/.env` (not only on VPS) |
| VPS runtime env | `/etc/cursor-worker.env` (rendered by Infisical Agent from **prod**) |
| VPS agent credentials | `/etc/infisical/client-id`, `client-secret` (identity `vps-cursor-worker`) |
| GitHub Actions bootstrap | Repo secrets `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET` only (`ci-github-actions`) |
| Local / Cursor | Infisical CLI + direnv (see step below when enabled) |

Project id: `dfa13c01-4d8c-48e3-b725-b56b1a36f338` · slug: `win-predict-ai-s-vm-f`  
Machine identities: `vps-cursor-worker`, `ci-github-actions` (Viewer → Production).

**Critical:** a Postgres backup without `ENCRYPTION_KEY` cannot be decrypted. Store the key off this VPS.

## Add a new secret

1. Infisical UI → project **win-predict-ai** → **Add Secret**
2. Key = exact env name expected by code (e.g. `NEW_API_KEY`)
3. Value — paste in UI only (not chat/git)
4. Environments: **Development** and/or **Production** as needed
5. Within ~60s VPS Agent rewrites `/etc/cursor-worker.env` and restarts `cursor-worker`
6. Next GitHub Actions run picks Production automatically

## Rotate a secret

1. Generate the new value at the source (GitHub PAT, Cursor key, Telegram, …)
2. Update the secret in Infisical (both envs if both use it)
3. Wait for Agent (~60s) or `systemctl restart infisical-agent`
4. Confirm VPS: `grep -E '^[A-Z_]+=' /etc/cursor-worker.env | cut -d= -f1`
5. Trigger a safe Actions run (`/orchestrate` on a test Goal) if CI must see it
6. Revoke the **old** credential at the provider

Rotate Infisical machine Client Secrets periodically; update `/etc/infisical/client-secret` and GitHub `INFISICAL_CLIENT_SECRET`.

## If something breaks

| Symptom | Check |
|---------|--------|
| Actions: Infisical step fails | GitHub secrets `INFISICAL_*`; identity `ci-github-actions`; UI https://secrets.win-predict-ai.com |
| VPS worker missing env | `systemctl status infisical-agent`; `journalctl -u infisical-agent -n 50` |
| Site down | `docker compose -f /opt/infisical/docker-compose.yml ps`; nginx; `curl -I https://secrets.win-predict-ai.com` |
| Locked out of UI | SMTP may be unset (password reset emails); use Server Console / DB only as last resort |

Restore from backup: see [Disaster restore](#disaster-restore) below.

## Backups (Postgres → off-box S3)

Scripts: [`infra/infisical/backup/`](infra/infisical/backup/).

- Daily `pg_dump` from container `infisical-db`
- Upload to S3-compatible bucket (Cloudflare R2 / B2 / AWS / Yandex) — **not** only local disk
- Config on VPS: `/etc/infisical/backup.env` (from `backup.env.example`) — never commit

## Agent healthcheck (email)

Scripts: [`infra/infisical/healthcheck/`](infra/infisical/healthcheck/).

- systemd timer checks `infisical-agent` is active and `/etc/cursor-worker.env` has required keys
- On failure, sends email via SMTP settings in `/etc/infisical/alert-smtp.env`

## Updating Infisical

Before prod upgrade:

1. Read [Infisical changelog](https://github.com/Infisical/infisical/releases) for breaking changes
2. Take a fresh backup: `/opt/infisical/backup/run-backup.sh`
3. Pin image tag in `docker-compose.yml` when stable (avoid surprise `latest`)
4. On VPS:

```bash
cd /opt/infisical
docker compose pull
docker compose up -d
docker compose ps
curl -sS -o /dev/null -w "%{http_code}\n" https://secrets.win-predict-ai.com/
```

## Disaster restore

Need: (1) `ENCRYPTION_KEY` + `AUTH_SECRET` from password manager, (2) latest `.sql.gz` from S3, (3) this repo’s `infra/infisical/docker-compose.yml`.

1. New or cleaned VPS: install Docker, copy compose + `.env.example` → `.env`
2. Put **original** `ENCRYPTION_KEY` / `AUTH_SECRET` / DB password into `.env` (`SITE_URL=https://secrets.win-predict-ai.com`)
3. `docker compose up -d` once so Postgres initializes, then stop app if needed:

```bash
cd /opt/infisical
docker compose up -d db
# wait healthy
gunzip -c /path/to/infisical_YYYYMMDD.sql.gz | docker exec -i infisical-db psql -U infisical -d infisical
docker compose up -d
```

4. Restore nginx + certbot for `secrets.win-predict-ai.com`
5. Reinstall Infisical Agent credentials + `systemctl enable --now infisical-agent`
6. Re-add GitHub `INFISICAL_*` if lost; verify UI login and one secret read

Without the original `ENCRYPTION_KEY`, stop: the dump is ciphertext only.

## Related paths

- Deploy notes: [`infra/infisical/DEPLOY.md`](infra/infisical/DEPLOY.md)
- Agent ops: [`orchestrator/ops/infisical/README.md`](orchestrator/ops/infisical/README.md)
