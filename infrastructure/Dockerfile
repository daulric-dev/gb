FROM oven/bun:1.4.5-alpine AS base
WORKDIR /app

# --- install: resolve the whole workspace (turbo + every workspace's deps) ---
FROM base AS install
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY docs/package.json docs/package.json
COPY mobile/package.json mobile/package.json
# The backend's postinstall runs `prisma generate`, which needs the schema.
COPY backend/prisma.config.ts backend/prisma.config.ts
COPY backend/prisma backend/prisma
RUN bun install --frozen-lockfile

# --- build: compile the backend used by this image ---
FROM install AS build
# Public build-time env baked into the frontend (Next.js) bundle.
ENV NEXT_PUBLIC_API_URL=http://localhost:3001
# Copy all source (node_modules/dist/.next/.git excluded via .dockerignore).
COPY . .
# The production image only runs the backend; avoid building unrelated clients.
# The backend build runs `prisma generate` first (no database needed).
RUN bunx turbo run build --filter=backend

# --- prod-deps: only the backend's runtime dependencies ---
# A separate install without devDependencies or the other workspaces' deps
# (frontend, docs, mobile), so the image doesn't ship the whole monorepo's
# node_modules. Every workspace manifest is still needed for the
# --frozen-lockfile check. The postinstall `prisma generate` runs here too,
# hence the schema; its output is unused (dist already holds the client).
FROM base AS prod-deps
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY docs/package.json docs/package.json
COPY mobile/package.json mobile/package.json
COPY backend/prisma.config.ts backend/prisma.config.ts
COPY backend/prisma backend/prisma
RUN bun install --frozen-lockfile --production --filter backend

# --- production: run the compiled backend ---
FROM base AS production
ENV NODE_ENV=production
# Bun's isolated linker: packages live in /app/node_modules/.bun and
# backend/node_modules holds relative symlinks into it, so copy both from the
# same install.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/backend/node_modules ./backend/node_modules
# dist: the compiled API, with the generated Prisma client (src/generated)
# and the throttle .lua asset. prisma + prisma.config.ts: `prisma db push`
# in the release step at start. src, scripts and tsconfig.json (its @/ path
# alias): the TypeScript scripts - the release step (`bun run db:release`)
# and the maintenance scripts (`bun run erasure:replay`, ...).
COPY --from=build /app/backend/package.json /app/backend/tsconfig.json /app/backend/prisma.config.ts ./backend/
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/src ./backend/src
COPY --from=build /app/backend/scripts ./backend/scripts
WORKDIR /app/backend

USER bun

EXPOSE 3001
# Bring the database up to the schema, then start the API. `bun run
# db:release` = db:prepare, `prisma db push` (never --accept-data-loss), then
# db:harden (backend/prisma/DATABASE_PORTABILITY.md), all under a PostgreSQL
# advisory lock, so replicas starting together take turns. Set
# MIGRATE_ON_START=false to run it as a separate release step instead
# (`docker compose --profile release run --rm migrate`).
CMD ["sh", "-c", "if [ \"${MIGRATE_ON_START:-true}\" != \"false\" ]; then bun run db:release || exit 1; fi; exec bun --bun dist/src/main"]
