---
sidebar_label: 2026-05-24 · Infrastructure CI
sidebar_position: 6
---

# 2026-05-24 - Infrastructure CI: Dockerfile & build workflow

## What changed

The `infrastructure/` folder was missing a Dockerfile and the CI workflow only validated config syntax without building anything. Added a real Dockerfile, fixed the compose context, and split the workflow logic out into reusable scripts.

### New: `infrastructure/Dockerfile`

Multi-stage Bun build for the NestJS backend:

1. **install** - copies the root + every workspace `package.json` (`backend`, `frontend`, `docs`) and runs `bun install`. The frontend/docs `package.json` files are stub-copied so Bun's workspace resolver doesn't error on missing workspaces, even though only the backend actually gets built.
2. **build** - pulls the whole install-stage workspace (so workspace-local `node_modules` directories survive), copies the backend source, and runs `bunx nest build`. Using `bunx` instead of `nest` directly side-steps PATH/hoisting issues with the NestJS CLI binary.
3. **production** - copies only `dist/` and `node_modules` into a slim `oven/bun:1.3.13-alpine` image; entrypoint is `bun --bun dist/src/main`.

### Updated: `infrastructure/docker-compose.yml`

Changed `build: .` to use the repo root as context so the Dockerfile can reach `backend/`:

```yaml
build:
  context: ..
  dockerfile: infrastructure/Dockerfile
```

### New: `.github/scripts/` helpers

The reverse-proxy test that used to be inlined in the workflow YAML is now four small scripts under `.github/scripts/`, alongside the existing CI helpers:

| Script | Purpose |
|---|---|
| `validate-nginx.sh` | Runs `nginx -t` inside `nginx:alpine` against the real config files. |
| `start-mock-upstreams.sh` | Boots three throwaway Python HTTP servers on 3004/3005/3006 that each reply with their port. |
| `start-nginx-test.sh` | Starts `nginx:alpine` in host-network mode so its `127.0.0.1` upstream references resolve to the mock servers. |
| `test-reverse-proxy.sh` | Pings each upstream directly, then sends 9 requests through nginx and asserts all 3 upstreams were hit (proves round-robin). |

The scripts resolve `infrastructure/nginx/` relative to the repo root, so they also work when run locally (`./.github/scripts/test-reverse-proxy.sh`).

### Updated: `.github/workflows/infrastructure.yml`

Three jobs, each step now a one-line script invocation:

| Job | Purpose |
|---|---|
| **nginx** | `validate-nginx.sh` - nginx config syntax check |
| **build** | `docker compose config` + `docker compose build` - validates compose file and compiles all images |
| **reverse-proxy** | Runs the mock-upstream + nginx + reverse-proxy scripts to verify round-robin load balancing across all 3 backends |

## Why

Previously a broken Dockerfile or build failure would only surface at deploy time. The workflow now catches build regressions on every push to `infrastructure/**`.

A previous iteration tried to smoke-test the full Compose stack (`up -d` then curl nginx), but the real NestJS backend needs Supabase + Redis to boot, and the nginx config uses `127.0.0.1` upstreams which only resolve correctly under host networking - not Compose's default bridge network. The mock-upstream approach tests nginx routing in isolation, while the build job separately verifies the backend image compiles end-to-end.

Extracting the CI logic into `.github/scripts/` keeps the workflow YAML focused on orchestration (job dependencies, failure handlers, cleanup) and makes the verification steps locally runnable for debugging.
