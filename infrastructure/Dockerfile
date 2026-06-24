FROM oven/bun:1.3.13-alpine AS base
WORKDIR /app

# --- install: resolve the whole workspace (turbo + every workspace's deps) ---
FROM base AS install
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY docs/package.json docs/package.json
RUN bun install --frozen-lockfile

# --- build: compile the backend through turbo ---
FROM install AS build
COPY turbo.json tsconfig*.json ./
COPY backend ./backend
RUN bunx turbo run build --filter=backend

# --- production: run the compiled backend ---
FROM base AS production
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend ./backend
WORKDIR /app/backend

USER bun

EXPOSE 3004
CMD ["bun", "--bun", "dist/src/main"]
