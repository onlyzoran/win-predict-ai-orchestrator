# Infisical Agent on win-predict-vps

Renders Production secrets into `/etc/cursor-worker.env` every 60s and restarts
`cursor-worker.service` when the file changes.

## One-time setup (root on VPS)

1. Install CLI:

```bash
curl -1sLf 'https://artifacts-cli.infisical.com/setup.deb.sh' | sudo -E bash
apt-get install -y infisical
```

2. Copy files from this directory to `/etc/infisical/` (see install script / agent).

3. Put Universal Auth credentials for identity `vps-cursor-worker` (not in git/chat):

```bash
install -d -m 700 /etc/infisical
printf '%s' 'YOUR_CLIENT_ID' > /etc/infisical/client-id
printf '%s' 'YOUR_CLIENT_SECRET' > /etc/infisical/client-secret
chmod 600 /etc/infisical/client-id /etc/infisical/client-secret
```

4. Confirm project **slug** in Infisical → Project Settings. If it is not
   `win-predict-ai`, edit `cursor-worker.env.tpl` accordingly.

5. Enable agent:

```bash
systemctl daemon-reload
systemctl enable --now infisical-agent.service
systemctl status infisical-agent.service
```

6. Check rendered file (keys only, or carefully):

```bash
grep -E '^[A-Z_]+=' /etc/cursor-worker.env | cut -d= -f1
# Expect: CURSOR_API_KEY GITHUB_PAT TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID
```

## Rotation

Change a secret in Infisical Production → within ~60s the agent rewrites the
env file and restarts `cursor-worker`.
