FROM oven/bun:1.3.13-alpine AS base
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
RUN bun install

# --- build: compile the backend used by this image ---
FROM install AS build
# Public build-time env baked into the frontend (Next.js) bundle.
ENV NEXT_PUBLIC_API_URL=http://localhost:3001 \
    NEXT_PUBLIC_DEDICATED_DEPLOYMENT=false
# Copy all source (node_modules/dist/.next/.git excluded via .dockerignore).
COPY . .
# The production image only runs the backend; avoid building unrelated clients.
# The backend build runs `prisma generate` first (no database needed).
RUN bunx turbo run build --filter=backend

# --- production: run the compiled backend ---
FROM base AS production
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend ./backend
WORKDIR /app/backend

USER bun

EXPOSE 3004
# Apply pending Prisma migrations, then start the API. `prisma migrate deploy`
# takes an advisory lock, so replicas starting together are safe. Set
# MIGRATE_ON_START=false to run migrations as a separate release step instead
# (`docker compose run --rm migrate`, or `bunx prisma migrate deploy`).
CMD ["sh", "-c", "if [ \"${MIGRATE_ON_START:-true}\" != \"false\" ]; then bunx prisma migrate deploy || exit 1; fi; exec bun --bun dist/src/main"]
