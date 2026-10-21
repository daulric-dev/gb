---
sidebar_label: Overview
---

# Backend Overview

The backend is a **NestJS** application running on the **Fastify** HTTP adapter. It serves as the REST API for the GradeBook application, handling authentication, school management, academic structure, student enrollment, grading, and grade calculations.

## Tech Stack

| Technology | Purpose |
|------------|---------|
| NestJS 12 | Application framework |
| Fastify | HTTP server (replaces Express for performance) |
| PostgreSQL + Prisma 7 | Database and ORM (`PrismaService`); access is enforced in the API |
| S3-compatible storage | File storage (`StorageService`, presigned uploads) |
| SMTP | Email, e.g. sign-in codes (`MailService`; Mailpit in development) |
| TypeScript 5 | Type safety |
| Bun Test | Testing framework (built-in `bun:test`) |
| Swagger | API documentation (auto-generated at `/docs`) |
| class-validator | DTO validation |

## Project Structure

```
backend/
├── api/
│   └── index.ts               # Vercel serverless entry point
├── vercel.json                # Vercel routing and build config
├── src/
│   ├── createApp.ts           # Shared app bootstrap (used by main.ts and api/index.ts)
│   ├── main.ts                # Local dev entry point (calls createApp + listen)
│   ├── worker.ts              # Cloudflare Workers entry point
│   ├── app.module.ts          # Root module
│   ├── app.controller.ts      # Health check endpoint
│   ├── app.service.ts         # Health check service
│   ├── stubs/
│   │   └── empty.js           # Stub for optional NestJS deps during CF Workers bundling
│   ├── generated/prisma/      # Generated Prisma client (from prisma/schema/*.prisma)
│   ├── prisma/                # PrismaService (global database client)
│   ├── storage/               # StorageService (S3 object storage, presigned URLs)
│   ├── mail/                  # MailService (SMTP)
│   ├── account/               # Users, sessions (gb_session cookie), email sign-in codes
│   ├── sso/                   # Single sign-on (OIDC for Google/Microsoft, SAML)
│   ├── auth/                  # Authentication endpoints (OTP, onboarding, avatar)
│   ├── school/                # School management
│   ├── academic-year/         # Academic year lifecycle
│   ├── term/                  # Term management within years
│   ├── pagination/            # Reusable pagination service (offset + cursor)
│   ├── versioning/            # Header-based response versioning service
│   ├── student/               # Student records
│   ├── subject/               # Subject definitions
│   ├── class/                 # Class (student group) management
│   ├── enrollment/            # Student enrollment and subject assignment
│   ├── grading/               # Assessments and grades
│   ├── calculation/           # Grade calculations and summaries
│   ├── reporting/             # Report generation, status workflow, file storage
│   ├── report-files/          # Server-side PDF/CSV/XLSX/zip generation + streaming
│   ├── announcement/          # School-wide announcement board + read receipts
│   ├── file-manager/          # Personal files, sharing, virus scan, notifications
│   ├── chat/                  # Real-time DMs (SSE + Redis pub/sub) + system messages
│   ├── images/                # Avatar upload service (direct + presigned PUT) and public avatar route
│   ├── queue/                 # BullMQ file pipeline: ingest, share-notify
│   ├── scan/                  # ClamAV virus scanner (global; used at every upload)
│   └── cache/                 # Pluggable caching (memory or Redis)
```

## Application Bootstrap

The app bootstrap logic lives in `src/createApp.ts` and is shared between all entry points. It configures:

- **Adapter**: Fastify
- **Global prefix**: `api` - all routes are prefixed with this
- **Swagger**: Available at `/docs`
- **Validation**: Global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, and `transform` enabled
- **CORS**: Allows requests from `FRONTEND_URL` environment variable (defaults to `http://localhost:3000`)
- **Multipart**: `@fastify/multipart` with 10MB file size limit

`createApp()` calls `app.init()` but does **not** call `app.listen()`. Each entry point handles the serving strategy:

| Entry Point | File | Behavior |
|-------------|------|----------|
| **Local dev** | `src/main.ts` | Calls `createApp()` then `app.listen()` on `PORT` (default 3001) |
| **Vercel** | `api/index.ts` | Calls `createApp()`, caches the app instance, pipes Node.js requests through Fastify |
| **Cloudflare Workers** | `src/worker.ts` | Lazy init, transfers env to `process.env`, uses Fastify `.inject()` |

## Deployment

### Vercel (Serverless)

The backend deploys to Vercel as a single serverless function:

- `vercel.json` routes all requests (`/(.*)`) to `api/index.ts` via `@vercel/node`
- The NestJS app is created once on cold start and cached for subsequent requests
- Environment variables are configured in the Vercel dashboard

### Cloudflare Workers

- `wrangler.toml` configures the worker with `nodejs_compat` flag
- `src/worker.ts` handles the `fetch` event and uses Fastify's `.inject()` method
- Optional NestJS dependencies are stubbed via `[alias]` in `wrangler.toml`

## Root Module (`app.module.ts`)

Imports all feature modules and configures global providers:

- `ConfigModule.forRoot({ isGlobal: true })` - environment variable access
- `ThrottlerModule` - rate limiting (100 requests per 60 seconds per client)
- `APP_GUARD` → `ThrottlerGuard` - applied globally to all endpoints
- `APP_GUARD` → `VersioningGuard` - validates `X-API-Version` header globally before handlers run

### Module Dependency Tree

```
AppModule
├── ConfigModule (global)
├── ThrottlerModule (global guard)
├── PrismaModule (global - provides PrismaService)
├── StorageModule (global - provides StorageService)
├── MailModule (global - provides MailService)
├── AccountModule (global - users, sessions, email codes)
├── AuthModule (exports AuthGuard; imports ImagesModule for avatar endpoints)
├── SchoolModule
├── AcademicYearModule
├── TermModule
├── StudentModule
├── SubjectModule
├── ClassModule (exports ClassTeacherGuard)
├── EnrollmentModule (imports ClassModule for guard)
├── GradingModule
├── CalculationModule
├── ReportingModule (exports ReportService - used by ReportFilesModule)
├── ReportFilesModule (server-side report file generation + streaming)
├── AnnouncementModule (announcement board + read receipts)
├── FileManagerModule (personal files, sharing, notifications)
├── RealtimeModule (global - exports RedisPubSubService + PresenceService; Redis pub/sub bus + online-presence tracking)
├── ChatModule (global - real-time DMs over SSE + Redis pub/sub; exports ChatSystemService)
├── QueueModule (global - BullMQ file ingest/share-notify with inline fallback)
├── ScanModule (global - exports ClamavScanner; scans every storage upload)
├── ImagesModule (exports ImagesService - used by AuthModule for avatar uploads)
├── PaginationModule (global - exports PaginationService for offset/cursor pagination)
├── VersioningModule (global - exports VersioningService; includes TransformerRegistry and VersioningGuard)
└── CacheModule (global - exports CacheService with memory or Redis store)
```

> See [versioning.md](./versioning.md) for how API versioning and pagination work.

## Database Access

The `PrismaModule` is marked `@Global()` and provides `PrismaService` (a Prisma 7 client over plain Postgres via `DATABASE_URL`) to all modules. The schema lives in `backend/prisma/schema/*.prisma`, with migrations under `backend/prisma/migrations/` (starting from `0_baseline`). There is no row-level security: every query runs with the same database role, and the API enforces who may read or write what.

## Database Schemas

The PostgreSQL database uses multiple schemas to organize tables:

| Schema | Contains |
|--------|----------|
| `account` | `app_user`, `session`, `email_code` (own auth) |
| `public` | `user_profile`, `school`, `academic_year`, `term`, `subject`, `student_group`, `announcement`, `announcement_read` |
| `student` | `student`, `student_group_enrollment`, `student_subject_profile` |
| `staff` | `teacher_group_assignment`, `teacher_subject_assignment` |
| `grading` | `assessment`, `grade` |
| `reporting` | `report_book`, `report_book_entry`, `report_book_pdf`, `class_report_file` |
| `file_manager` | `file`, `file_share`, `notification`, `folder` |
| `chat` | `conversation`, `conversation_member`, `message` |

## Guards

| Guard | Location | Behavior |
|-------|----------|----------|
| `ThrottlerGuard` | Global (APP_GUARD) | Rate limits all endpoints |
| `VersioningGuard` | Global (APP_GUARD) | Validates `X-API-Version` header; rejects invalid/non-existent versions with 400 |
| `AuthGuard` | `auth/auth.guard.ts` | Resolves the `gb_session` cookie via `SessionService` (renewing the sliding 30-day expiry when due) and rejects deactivated accounts; populates `request.user` with `{ id, email }` |
| `ClassTeacherGuard` | `class/class-teacher.guard.ts` | Checks if the user is an admin or the class teacher for the `:classId` route parameter |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `AUTH_SECRET` | Yes (production) | Keys the hashes of sign-in codes and session tokens |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Yes | Object storage (omit `S3_ENDPOINT` for AWS S3) |
| `SMTP_URL`, `MAIL_FROM` | Yes | Outgoing email |
| `FRONTEND_URL` | No | CORS origin (defaults to `http://localhost:3000`) |
| `PORT` | No | Server port (defaults to `3001`) |
| `USE_REDIS` | No | Set to `true` to use Redis for caching (defaults to in-memory) |
| `REDIS_URL` | Only if `USE_REDIS=true` | Redis connection URL (e.g., `redis://localhost:6379`) |

## Running the Backend

```bash
cd backend
bun install
bun run start:dev    # Development with hot-reload
bun run build        # Production build
bun run start:prod   # Production server
bun run lint         # ESLint check
bun run test         # Unit tests (Bun test runner)
```

### Deploying

```bash
# Vercel
vercel deploy              # Deploy to Vercel (uses vercel.json)

# Cloudflare Workers
bun run deploy             # Deploy via wrangler
bun run deploy:staging     # Deploy to staging environment
```
