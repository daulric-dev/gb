---
sidebar_label: 2026-05-24 · Infrastructure CI
sidebar_position: 6
---

# 2026-05-24 — Infrastructure CI: Dockerfile & build workflow

## What changed

The `infrastructure/` folder was missing a Dockerfile and the CI workflow only validated config syntax without building anything.

### New: `infrastructure/Dockerfile`

Multi-stage Bun build for the NestJS backend:

1. **install** — copies root + backend `package.json` and runs `bun install --frozen-lockfile`.
2. **build** — runs `nest build` to compile TypeScript.
3. **production** — copies only `dist/` and `node_modules` into a slim `oven/bun:1.3.13-alpine` image.

### Updated: `infrastructure/docker-compose.yml`

Changed `build: .` to use the repo root as context so the Dockerfile can reach `backend/`:

```yaml
build:
  context: ..
  dockerfile: infrastructure/Dockerfile
```

### Updated: `.github/workflows/infrastructure.yml`

Three jobs:

| Job | Purpose |
|---|---|
| **nginx** | `nginx -t` syntax check |
| **build** | Validates compose file, then runs `docker compose build` to compile all images |
| **reverse-proxy** | Spins up Python mock upstreams on 3004/5/6, runs nginx with host networking, and verifies round-robin load balancing across all 3 backends |

## Why

Previously a broken Dockerfile or build failure would only surface at deploy time. The workflow now catches build regressions on every push to `infrastructure/**`.

The reverse-proxy job uses mock Python HTTP servers rather than booting the real NestJS stack — the real backend needs Supabase/Redis to start, which would require provisioning real external services just to validate nginx routing. The mock approach tests nginx config + routing in isolation, while the build job separately validates that the backend image actually compiles.
