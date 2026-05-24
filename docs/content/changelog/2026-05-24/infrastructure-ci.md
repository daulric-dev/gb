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

Replaced the old validation-only jobs with three jobs:

| Job | Purpose |
|---|---|
| **nginx** | `nginx -t` syntax check (unchanged) |
| **build** | Validates compose file, then runs `docker compose build` to compile all images |
| **smoke-test** | Starts the full stack (`up -d`), waits for readiness, curls nginx to verify it responds, then tears down |

## Why

Previously a broken Dockerfile or build failure would only surface at deploy time. The workflow now catches build regressions on every push to `infrastructure/**`.
