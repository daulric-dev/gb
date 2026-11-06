# Running GradeBook with PM2 (bare metal / VM)

An alternative to the Docker Compose stack ([`../docker-compose.yml`](../docker-compose.yml),
still the primary deployment) for servers where you run the apps directly:
[PM2](https://pm2.keymetrics.io/) supervises the API and the web frontend, and
Caddy on the same host terminates TLS and balances over the API processes.

The same PM2 setup also powers `bun run preview` on a laptop (see
[Local preview](#local-preview)); `bun run dev` does not use PM2.

| File | What it is |
| --- | --- |
| [`ecosystem.config.cjs`](./ecosystem.config.cjs) | PM2 process file for servers (`gradebook-api`, `gradebook-web`) |
| [`apps.cjs`](./apps.cjs) | The app definitions behind both process files; every tuning variable |
| [`api-ready.cjs`](./api-ready.cjs) | API entry point: sets each instance's port, starts `backend/dist/src/main.js`, reports "ready" to PM2 |
| [`deploy.sh`](./deploy.sh) | Install, build, migrate, `pm2 startOrReload`, `pm2 save` |
| [`setup.sh`](./setup.sh) | One-time server setup: PM2, pm2-logrotate, log directory, boot instructions |
| [`Caddyfile`](./Caddyfile) | Reverse proxy + automatic HTTPS for the API and the frontend |
| [`preview.config.cjs`](./preview.config.cjs), [`preview.sh`](./preview.sh) | `bun run preview` |
| `logs/` | Default log directory (gitignored) |

## What runs where

```text
Internet ─ 443 ─> Caddy (host) ─┬─ api.example.com ─> 127.0.0.1:3001-3003  gradebook-api (Bun, PM2 fork mode, 3 processes)
                                └─ app.example.com ─> 127.0.0.1:3000       gradebook-web (Node, PM2 cluster mode, `next start`)

gradebook-api ──> PostgreSQL, Redis, S3, SMTP (managed services or `docker compose up -d redis` ...)
```

- **gradebook-api**: the compiled NestJS API (`backend/dist`), run by Bun 1.4.4
  with `backend/` as working directory. PM2's cluster mode needs Node's
  `cluster` module, which Bun does not have, so the API runs in **fork mode**:
  `API_INSTANCES` separate processes (default 3) on `API_BASE_PORT` (3001),
  3002, 3003. More than one instance needs `USE_REDIS=true`; the config refuses
  to load otherwise.
- **gradebook-web**: `next start` for `frontend/` on Node, in PM2 **cluster
  mode** (`WEB_INSTANCES` workers, default 1, sharing `WEB_PORT` 3000, bound to
  `127.0.0.1`).
- **Caddy** runs on the host (e.g. the distribution's `caddy` package as a
  systemd service) with [`Caddyfile`](./Caddyfile).

Both apps restart on crash with exponential backoff (100ms doubling to 15s),
are restarted above `API_MAX_MEMORY` / `WEB_MAX_MEMORY`, and get `SIGTERM`
then, after `kill_timeout` (API 15s, web 10s), `SIGKILL`.

## Requirements

- **Bun 1.4.4** (`packageManager` in the root `package.json`) for installing,
  building and running the API.
- **Node.js >= 20.9** for Next.js and PM2 itself (the PM2 daemon forks the
  Next.js workers with its own Node).
- **PM2** (installed by `setup.sh`).
- **PostgreSQL 15+, Redis, S3-compatible storage, SMTP**: managed services, or
  on the same box. Redis from the Compose file works
  (`docker compose -f infrastructure/docker-compose.yml up -d redis`), but it
  publishes no port, so add a `127.0.0.1:6379:6379` port mapping or run Redis
  natively. See [`../SERVICES.md`](../SERVICES.md) for what each one is used
  for and [`docs/content/hosting-requirements.md`](../../docs/content/hosting-requirements.md)
  for sizing.
- **Caddy 2** for TLS and load balancing.
- Firewall: only 80 and 443 public. The API binds `0.0.0.0` (3001-3003), so
  block those ports from outside.

## Environment files

| File | Used by | Contents |
| --- | --- | --- |
| `backend/.env` | API (Bun loads it from `backend/`) and `prisma migrate deploy` | Production values: `DATABASE_URL`, `AUTH_SECRET` (32+ chars), `API_URL` (https), `FRONTEND_URL` (https, not localhost), `USE_REDIS=true` and `REDIS_URL`, `S3_*`, SMTP, ... Template: `backend/.env.example`; reference: [`docs/content/environment-variables.md`](../../docs/content/environment-variables.md). |
| `frontend/.env.production` | `next build` (and `next start`) | `NEXT_PUBLIC_API_URL=https://api.example.com` and `NEXT_PUBLIC_STORAGE_URL=https://<bucket endpoint>`. Inlined into the browser bundle **at build time**: change them, then redeploy. |

Notes:

- `NODE_ENV=production` is set by PM2; leave it out of the files.
- Never set `LOCAL_PREVIEW` on a server (the config refuses to load with it).
- The environment wins over `backend/.env`, and `deploy.sh` passes the shell
  environment to the apps (`--update-env`), so don't export app settings in
  the deploy user's shell profile.
- Don't keep a `frontend/.env.local` on the server: Next.js lets it override
  `.env.production` (`deploy.sh` warns).
- Migrations run in `deploy.sh`, not at process start (unlike the Docker
  image's `MIGRATE_ON_START`).

## First deploy

As the user that will own the processes (not root), with the repository
checked out at the release to run:

```bash
infrastructure/pm2/setup.sh            # PM2, logrotate, log dir; prints a `sudo ... pm2 startup` line
# run the printed sudo command once, so PM2 (and the saved apps) start at boot
cp backend/.env.example backend/.env   # then fill in production values
$EDITOR frontend/.env.production       # NEXT_PUBLIC_API_URL, NEXT_PUBLIC_STORAGE_URL
infrastructure/pm2/deploy.sh
```

`deploy.sh` checks Bun, Node >= 20.9, PM2, `backend/.env` and
`NEXT_PUBLIC_API_URL`, then runs `bun install --frozen-lockfile`, builds the
backend (`prisma generate && nest build`) and the frontend (`next build`),
runs `bunx prisma migrate deploy` (skip with `SKIP_MIGRATE=1`), and
`pm2 startOrReload infrastructure/pm2/ecosystem.config.cjs --update-env` plus
`pm2 save`.

Then Caddy, e.g. with the distribution package: point it at this file and give
it the variables (systemd `Environment=` lines or `/etc/default/caddy`, per
your package):

```bash
SITE_ADDRESS=api.example.com WEB_SITE_ADDRESS=app.example.com ACME_EMAIL=ops@example.com \
  caddy run --config /path/to/gb/infrastructure/pm2/Caddyfile
```

DNS for both hostnames must point at the server, with ports 80 and 443 open.
Behind another TLS proxy, use `http://api.example.com` / `http://app.example.com`
and see "Plain HTTP behind another proxy" in [`../SERVICES.md`](../SERVICES.md#caddy).
The API upstreams in the Caddyfile are 3001-3003: edit the list if you change
`API_INSTANCES` or `API_BASE_PORT`.

## Updates

```bash
git fetch --tags && git checkout v1.2.3
infrastructure/pm2/deploy.sh
```

**Zero downtime.** Migrations are applied before any process runs the new
code. Then each API instance is restarted **one at a time**: `deploy.sh` sets
`PM2_CONCURRENT_ACTIONS=1` (PM2 otherwise restarts two at once), and
`api-ready.cjs` tells PM2 an instance is ready only once it answers `GET /`
(`wait_ready`), so the next instance is stopped only after the previous one
is back. During each restart Caddy sends requests to the others (it retries a
refused connection on another instance for up to 5s and health-checks every
10s). The frontend is reloaded by cluster mode: a new worker listens before the
old one stops. Migrations must therefore stay compatible with the code that is
still running during the rollout (add columns first, drop them a release
later).

Open SSE streams keep an API process alive during shutdown until
`API_KILL_TIMEOUT` (15s), then they are cut and clients reconnect to another
instance.

Changing `API_INSTANCES`, ports or other process options (not just env values)
is not applied by a reload: `pm2 delete gradebook-api gradebook-web`, then
`deploy.sh`. Update the Caddyfile upstreams to match.

## Rollback

```bash
git checkout v1.2.2
SKIP_MIGRATE=1 infrastructure/pm2/deploy.sh
```

Migrations are **forward-only**: rolling back the code does not undo the
schema. That is fine as long as the newer migrations were backwards
compatible (see above). Otherwise fix forward with a new migration, or restore
the database ([`../BACKUPS.md`](../BACKUPS.md)).

## Logs

```bash
pm2 logs                                 # follow everything
pm2 logs gradebook-api --lines 200
ls infrastructure/pm2/logs/              # gradebook-{api,web}.{out,error}.log
pm2 flush                                # empty the log files
```

All instances of an app share one `out` and one `error` file, each line
timestamped. Set `PM2_LOG_DIR` (when running `deploy.sh` and `setup.sh`) to
keep them elsewhere, e.g. `/var/log/gradebook`. pm2-logrotate (installed by
`setup.sh`) rotates them at 50M and daily, keeps 14, gzipped
(`LOGROTATE_MAX_SIZE`, `LOGROTATE_RETAIN`, `LOGROTATE_COMPRESS`; or
`pm2 set pm2-logrotate:<key> <value>`). The PM2 daemon's own log is
`~/.pm2/pm2.log`. Caddy logs requests to its stdout (`journalctl -u caddy`).

## Monitoring

```bash
pm2 status             # processes, restarts, memory, uptime
pm2 monit              # live CPU/memory and logs
pm2 describe gradebook-api
curl -fsS https://api.example.com/health   # database, Redis and S3 reachable
```

A rising restart count (`↺`) means crashes or memory restarts: check the
error log. Put `GET /health` on the API hostname into your external uptime
monitoring.

## Boot persistence

`setup.sh` prints the `sudo env PATH=... pm2 startup <init> -u <user> --hp <home>`
command for this server; run it once. It installs a systemd (or launchd...)
unit that starts the PM2 daemon at boot, which then restores the list saved by
`pm2 save` (every `deploy.sh` saves). After upgrading Node or PM2, run
`pm2 update` and re-run the `pm2 startup` command.

## Tuning

Read by [`apps.cjs`](./apps.cjs) from the environment of the shell running
`deploy.sh` / pm2:

| Variable | Default | Meaning |
| --- | --- | --- |
| `API_INSTANCES` | `3` (preview: `1`) | API processes; more than 1 needs `USE_REDIS=true` |
| `API_BASE_PORT` | `3001` | Instance N listens on `API_BASE_PORT + N` |
| `API_MAX_MEMORY` | `2G` | Restart an API process above this memory |
| `API_KILL_TIMEOUT` | `15000` | ms from `SIGTERM` to `SIGKILL` |
| `WEB_INSTANCES` | `1` | Next.js workers (`max` = one per CPU) |
| `WEB_PORT` | `3000` | Frontend port |
| `WEB_HOST` | `127.0.0.1` (preview: all interfaces) | Interface the frontend binds; empty = Next.js default |
| `WEB_MAX_MEMORY` | `1G` | Restart a frontend worker above this memory |
| `PM2_LOG_DIR` | `infrastructure/pm2/logs` | Log directory |
| `BUN_PATH` | `bun` on `PATH` | Bun binary for the API |

## Local preview

`bun run preview` runs [`preview.sh`](./preview.sh): it builds the backend and
frontend (`turbo run build`), then starts both in the background in your
normal PM2 daemon as `gradebook-preview-api` (one instance, port 3001) and
`gradebook-preview-web` (port 3000), and returns to the shell. `pm2 list`,
`pm2 logs` and `pm2 monit` show them. Stop with `bun run preview stop`
(or `pm2 delete infrastructure/pm2/preview.config.cjs`). Running preview again
replaces the running one. The apps are never `pm2 save`d, so they don't come
back after a reboot.

It uses the development env files (`backend/.env`, `frontend/.env.local`) plus
`NODE_ENV=production` and `LOCAL_PREVIEW=true`, which allows the
`http://localhost` `FRONTEND_URL`. PM2 comes from `PATH`, else `bunx`; set
`PREVIEW_PM2_HOME` to use a separate PM2 home. The tuning variables above apply
(e.g. `WEB_PORT=4000 bun run preview`).
