FROM oven/bun:1.3.13-alpine AS base
WORKDIR /app

# --- install: resolve the whole workspace (turbo + every workspace's deps) ---
FROM base AS install
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY docs/package.json docs/package.json
RUN bun install --frozen-lockfile

# --- build: build the entire monorepo through turbo ---
FROM install AS build
# Public build-time env baked into the frontend (Next.js) bundle.
ENV NEXT_PUBLIC_API_URL=http://localhost:3001 \
    NEXT_PUBLIC_DEDICATED_DEPLOYMENT=false
# Copy all source (node_modules/dist/.next/.git excluded via .dockerignore).
COPY . .
# Build every workspace (backend, frontend, docs) via the turbo task graph.
RUN bunx turbo run build

# --- production: run the compiled backend ---
FROM base AS production
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend ./backend
WORKDIR /app/backend

USER bun

EXPOSE 3004
CMD ["bun", "--bun", "dist/src/main"]
