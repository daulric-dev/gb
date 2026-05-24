FROM oven/bun:1.3.13-alpine AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY docs/package.json docs/package.json
RUN bun install

FROM base AS build
COPY --from=install /app ./
COPY package.json bun.lock tsconfig*.json ./
COPY backend ./backend
RUN cd backend && bunx nest build

FROM base AS production
COPY --from=install /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/package.json ./

EXPOSE 3004
CMD ["bun", "--bun", "dist/src/main"]
