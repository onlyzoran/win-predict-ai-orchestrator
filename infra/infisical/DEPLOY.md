# Deploy Infisical (self-hosted) on win-predict-vps

Do **not** run these on production until you have reviewed the files and confirmed.
Do **not** paste real secrets into chat or into git.

## Prerequisites

- Docker + Docker Compose plugin on the VPS
- nginx already serving the host (existing `/ops/`)
- Hostname: `secrets.win-predict-ai.com`
- DNS A (and optional AAAA) for that hostname → VPS public IP

## 0. Master keys — generate and store OFF this VPS

On your laptop (or another trusted machine):

```bash
openssl rand -hex 16      # → ENCRYPTION_KEY
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -base64 24   # → POSTGRES_PASSWORD (or any strong password)
```

Save **ENCRYPTION_KEY** and **AUTH_SECRET** in a password manager / offline safe.
A copy will also live in `/opt/infisical/.env` on the VPS so the app can start —
that must **not** be the only copy.

**Why:** secrets in Postgres are encrypted with material derived from
`ENCRYPTION_KEY`. A `pg_dump` without that key is useless ciphertext.
Losing the key = permanent loss of vault contents (even with perfect DB backups).

Infisical does not offer painless root-key rotation on the community build:
treat the key like a cold root of trust.

## 1. Directory on the VPS

```bash
sudo mkdir -p /opt/infisical
sudo chown "$USER":"$USER" /opt/infisical
# Copy docker-compose.yml from this repo into /opt/infisical/
cp docker-compose.yml /opt/infisical/
cp .env.example /opt/infisical/.env
chmod 600 /opt/infisical/.env
```

Edit `/opt/infisical/.env` **on the server** (editor, not chat):

- paste `ENCRYPTION_KEY`, `AUTH_SECRET`, `POSTGRES_PASSWORD`
- set `SITE_URL=https://secrets.win-predict-ai.com`
- leave `DB_CONNECTION_URI` / `REDIS_URL` as in the example unless you know better

## 2. Firewall (baseline)

Only these should be reachable from the internet:

| Port | Why |
|------|-----|
| 22 | SSH |
| 80 | HTTP → ACME + redirect |
| 443 | HTTPS UI |

Postgres, Redis, and Infisical `:8080` must **not** be open publicly.
This compose binds Infisical to `127.0.0.1:8080` only.

Example with UFW (adjust if you already use another firewall):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

## 3. Start the stack

```bash
cd /opt/infisical
docker compose up -d
docker compose ps
docker compose logs -f --tail=100 backend
```

Health: `curl -sS http://127.0.0.1:8080` should respond (may redirect).

## 4. nginx + Let's Encrypt

1. Copy `nginx-secrets.conf.example` → `/etc/nginx/sites-available/secrets.win-predict-ai.com`
2. Enable site, reload nginx (HTTP-only first is fine for ACME):

```bash
sudo ln -sf /etc/nginx/sites-available/secrets.win-predict-ai.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d secrets.win-predict-ai.com
```

3. Confirm `SITE_URL` in `.env` matches `https://secrets.win-predict-ai.com`, then:

```bash
cd /opt/infisical && docker compose up -d
```

Open the URL, create the first admin account in the UI (do not send that password in chat).

## 5. After deploy checklist

- [ ] UI loads over HTTPS
- [ ] `ENCRYPTION_KEY` / `AUTH_SECRET` saved outside this VPS
- [ ] `docker compose ps` — db / redis / backend healthy
- [ ] `ss -tlnp | grep -E ':8080|:5432|:6379'` — only 8080 on 127.0.0.1 (or nothing public)
- [ ] Existing `/ops/` still works on the same nginx

## What comes next (not this step)

- Infisical project + envs + machine identities
- Agent → `/etc/cursor-worker.env`
- GitHub Action + one bootstrap secret
- direnv locally
- Off-box Postgres dumps to S3 + email healthchecks
