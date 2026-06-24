---
sidebar_label: 2026-06-24 · Docker image builds via turbo
sidebar_position: 4
---

# 2026-06-24 - Docker image builds via turbo

Reworked the backend image so it builds the whole monorepo through turbo and ships a runnable backend, fixed the Compose topology, and simplified the infrastructure CI to a build.

## The image was missing runtime dependencies

`bun install` in this monorepo does not hoist every backend dependency to the root `node_modules`. 32 of the backend's core runtime packages (`@nestjs/*`, `@fastify/*`, `@supabase/*`, `fastify`, `class-validator`, `reflect-metadata`, `rxjs`, and others) live in `backend/node_modules`. The old Dockerfile copied only root `node_modules` into the production stage, so the container crashed at boot on `Cannot find module '@nestjs/core'` and never started serving. This only surfaced once CI actually ran the container, since earlier CI only built the image.

## Dockerfile

`infrastructure/Dockerfile` is now a three-stage build:

- **install** runs `bun install --frozen-lockfile` over the whole workspace.
- **build** copies all source and runs `bunx turbo run build`, building every workspace (backend, frontend, docs) through the turbo task graph. The frontend's `NEXT_PUBLIC_*` values are set as build-time env so the Next.js build is deterministic.
- **production** copies both root `node_modules` and the full `/app/backend` tree (which carries `backend/node_modules`), so no runtime dependency is missing, sets `NODE_ENV=production`, runs as the non-root `bun` user, and starts the backend with `bun --bun dist/src/main`.

## .dockerignore

A new `.dockerignore` at the repo root (the build context) excludes `**/node_modules`, `dist`, `.next`, `.turbo`, `.git`, and `.env*`. This keeps the host's macOS-built `node_modules` out of the Linux image (copying them would ship wrong-architecture binaries) and shrinks the build context. The Linux modules from the install stage are the ones that ship.

## Compose topology

[infrastructure/docker-compose.yml](../../../../infrastructure/docker-compose.yml) was modernized:

- Dropped the obsolete `version` key and set a fixed project name (`name: gb`) so `docker compose` resolves the same project across `up`, `ps`, `logs`, and `down`.
- Added a `redis` service and pointed the three app replicas at it (`REDIS_URL=redis://redis:6379`, `USE_REDIS=true`) over a shared `appnet` network.
- Added per-replica healthchecks (a `bun` one-liner against `127.0.0.1:$PORT/health`), `restart: unless-stopped`, and `env_file` so the replicas read Supabase keys and `FRONTEND_URL` from a local `.env`.

The nginx load balancer's upstreams in [nginx/default.conf](../../../../infrastructure/nginx/default.conf) now use the Compose service names (`app1:3004`, `app2:3005`, `app3:3006`) instead of `127.0.0.1`, which under Compose pointed nginx at itself.

A new [infrastructure/env.example](../../../../infrastructure/env.example) documents the required variables. Copy it to `infrastructure/.env` (gitignored) before running the stack. For local development against host-run Supabase, point `SUPABASE_URL` at `http://host.docker.internal:54321`.

## CI

[.github/workflows/infrastructure.yml](../../../../.github/workflows/infrastructure.yml) is now a single job that builds the image with `docker build -f infrastructure/Dockerfile -t gb-backend:ci .`. A green build is the signal that the project compiles and the image is producible.

## Verification

The full `turbo run build` was confirmed to build all three workspaces successfully. `backend/node_modules` was confirmed to hold the non-hoisted runtime packages the old image dropped, and the compiled backend boots and serves `/health` with 200 when its full `node_modules` is present.
