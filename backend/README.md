# GradeBook Backend

The GradeBook API: one NestJS service that every client - the Next.js web app (`frontend/`) and the Expo mobile app (`mobile/`) - talks to over HTTP. It holds all the secrets and all the access rules. It covers sign-in (email codes and single sign-on), schools and staff, the student roster, academic years and terms, courses (modules, pages, files, join codes, copy and templates), grading (activities, quizzes, submissions, rubrics, gradebook), attendance with student check-in, discussions, announcements, calendars, chat, a personal file manager, notifications, the student portal, and - on the hosted platform only - billing.

All routes are under `/api` (e.g. `GET /api/students`), except `GET /health`, `GET /` and, outside production, Swagger at `/docs`.

## Stack

|                        |                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework              | NestJS 12 on Fastify 5 (`@nestjs/platform-fastify`), validation with `class-validator`, OpenAPI with `@nestjs/swagger`                                                                |
| Runtime                | Bun (dev server, tests, scripts, production container)                                                                                                                                      |
| Database               | Postgres through Prisma 7 with the `pg` driver adapter; several Postgres schemas (`public`, `account`, `course`, `grading`, `student`, `file_manager`, `chat`, `billing`) |
| Cache, queue, realtime | Redis (optional): cache store, BullMQ jobs, pub/sub for SSE chat and attendance. Without it everything runs in-process, which is right for one instance only.                               |
| Files                  | Any S3-compatible object store (AWS S3, R2, B2; SeaweedFS locally), with presigned upload and download URLs                                                                                 |
| Email                  | SMTP via nodemailer (Mailpit locally)                                                                                                                                                       |
| Auth                   | Our own: email sign-in codes and `gb_session` cookie sessions; SSO with our own OpenID Connect (Google, Microsoft) and SAML 2.0                                                           |
| Push                   | Expo push service                                                                                                                                                                           |
| Payments (hosted only) | Stripe, PayPal, Paddle, WiPay or manual invoices                                                                                                                                            |

## Running it locally

Full walkthrough: [docs/content/developer-guide.md](../docs/content/developer-guide.md). The short version, from the **repo root** unless noted:

```bash
bun install                                  # every workspace; also runs prisma generate
cp backend/.env.example backend/.env         # defaults match the dev containers
bun run preload                              # start Postgres, Redis, S3 and Mailpit (docker-compose.dev.yml) and apply migrations
bun run dev:backend                          # or, in backend/: bun run start:dev  -> http://localhost:3001
```

Check it with `curl localhost:3001/health`. Swagger UI is at `http://localhost:3001/docs`. Sign-in codes are emailed to Mailpit at `http://127.0.0.1:8025`.

Local services from `docker-compose.dev.yml`:

| Service      | Address                                                  | Used for                                                           |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------ |
| Postgres 18  | `127.0.0.1:5432` (`gradebook` / `gradebook`)       | `DATABASE_URL`                                                   |
| Redis        | `127.0.0.1:6379`                                       | `REDIS_URL` (only used when `USE_REDIS=true`)                  |
| SeaweedFS S3 | `http://127.0.0.1:8333`                                | `S3_*`; the API creates the bucket on first start in development |
| Mailpit      | SMTP `127.0.0.1:1025`, inbox `http://127.0.0.1:8025` | `SMTP_URL`                                                       |

`bun run postload` stops the containers; data survives in Docker volumes.

### Backend commands (run in `backend/`)

| Command                                              | What it does                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `bun run start:dev`                                | API with file watching (`NODE_ENV=development bun --watch src/main.ts`).                                 |
| `bun run start:prod`                               | API in production mode from source (`bun src/main.ts`).                                                  |
| `bun run build`                                    | `prisma generate && nest build` into `dist/`.                                                          |
| `bun run test`                                     | `bun test src` (Bun's runner; `prisma generate` runs first). `bun test src/<folder>` for one module. |
| `bun run lint`                                     | ESLint over `src` with `--fix`.                                                                        |
| `bunx tsc --noEmit`                                | Typecheck, including test files (neither `bun test` nor the build typechecks tests).                     |
| `bun run db:deploy`                                | Apply pending migrations (`prisma migrate deploy`).                                                      |
| `bun run db:generate`                              | Regenerate the Prisma client into `src/generated/prisma`.                                                |
| `bun run db:pull` / `db:studio` / `db:migrate` | Introspect, browse, or `prisma migrate dev` (local only).                                                |
| `bun run seed:demo [--fresh]`                      | Create the demo school (API must be running with `ALLOW_DEV_LOGIN=true`).                                |
| `bun run smoke`                                    | End-to-end API check against the demo school.                                                              |
| `bun run student:check`                            | Student onboarding check: join code, link to roster record, portal; cleans up (see [scripts/README.md](./scripts/README.md)). |

Demo accounts, prerequisites and what each script checks: [scripts/README.md](./scripts/README.md).

### Configuration

All configuration is environment variables in `backend/.env` (template: [`.env.example`](./.env.example)). For local development the template works as is. In production `AUTH_SECRET`, `CHAT_ENCRYPTION_KEY` and `STUDENT_CLAIM_CODE_PEPPER` are required, and `FRONTEND_URL`, `API_URL` and `AUTH_COOKIE_DOMAIN` must match the real hosts. Every variable, its default and its failure mode: [docs/content/environment-variables.md](../docs/content/environment-variables.md). Each module README lists the variables it reads.

## Architecture

A request goes through these layers (details in [src/README.md](./src/README.md#request-flow)):

1. **Fastify** - cookies, multipart (10 MB), raw body for billing webhooks, CORS for the origins in `FRONTEND_URL`.
2. **Global guards** - `ThrottlerGuard` (rate limits keyed by session or client IP, [src/throttle](./src/throttle/README.md)) and `VersioningGuard` (`X-API-Version` header, [src/versioning](./src/versioning/README.md)).
3. **Route guards** - `AuthGuard` resolves the `gb_session` cookie into `req.user`; then `PermissionGuard` with `@RequirePermission(resource, action)` for staff routes, `AdminGuard` for school-admin routes, `StudentGuard` for `/api/portal/me/...`, or the billing guards. Course routes also check course roles with `CourseAccessService`.
4. **Interceptors** - `BillingEntitlementInterceptor` (global; with `BILLING_ENABLED=true` it answers 402 to mutations from schools whose subscription lapsed).
5. **Pipes** - the global `ValidationPipe` (whitelisting, rejecting unknown fields, transforming DTOs).
6. **Controllers -> services -> Prisma.** Services do the work, scoped to the caller's school, and use the shared global services: `PrismaService`, `CacheService`, `StorageService`, `MailService`, `FileQueueService`, the realtime bus. Some controllers pass results through `VersioningService`.

There is no row-level security in Postgres: the API connects as the schema owner, so guards and service code are the only access rules.

Entry points: `src/main.ts` (the server; used by `start:dev`, `start:prod` and the container in `infrastructure/Dockerfile`, which runs `prisma migrate deploy` on start). The container is the supported deployment: it runs the built server with `bun dist/src/main`.

## Folder index

| Path                                                          | What it is                                                                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [src/](./src/README.md)                                        | The application: root module, bootstrap, and one folder per module, each with its own README.                         |
| [prisma/](./prisma/README.md)                                  | Prisma schema ([schema/](./prisma/schema/README.md)) and SQL migrations ([migrations/](./prisma/migrations/README.md)). |
| [scripts/](./scripts/README.md)                                | `seed-demo`, `smoke`, `student-flow-check`.                                                                     |
| `prisma.config.ts`                                          | Prisma CLI config (schema and migrations paths, `DATABASE_URL`).                                                    |
| `nest-cli.json`, `tsconfig.json`, `tsconfig.build.json` | Nest build with the Swagger plugin; `@/*` path alias; tests excluded from the build.                                |
| `eslint.config.mjs`                                         | Lint config.                                                                                                          |
| `.env.example`                                              | Environment template.                                                                                                 |

## Documentation

- [docs/content/developer-guide.md](../docs/content/developer-guide.md) - setup, deployment, everyday commands.
- [docs/content/environment-variables.md](../docs/content/environment-variables.md) - every variable.
- Backend reference: [overview](../docs/content/backend/overview.md), [auth](../docs/content/backend/auth.md), [school](../docs/content/backend/school.md), [student](../docs/content/backend/student.md), [academic-year](../docs/content/backend/academic-year.md), [term](../docs/content/backend/term.md), [grading](../docs/content/backend/grading.md), [course-copy](../docs/content/backend/course-copy.md), [discussion](../docs/content/backend/discussion.md), [announcement](../docs/content/backend/announcement.md), [calendar-notifications](../docs/content/backend/calendar-notifications.md), [chat](../docs/content/backend/chat.md), [file-manager](../docs/content/backend/file-manager.md), [images](../docs/content/backend/images.md), [cache](../docs/content/backend/cache.md), [versioning](../docs/content/backend/versioning.md), [billing](../docs/content/backend/billing.md).
- [docs/content/sso.md](../docs/content/sso.md), [docs/content/dedicated-deployment.md](../docs/content/dedicated-deployment.md), [docs/content/billing-providers.md](../docs/content/billing-providers.md), [docs/content/platform-migration.md](../docs/content/platform-migration.md).
