---
sidebar_label: Overview
---

# Backend Overview

The backend is a **NestJS** application running on the **Fastify** HTTP adapter. It serves as the REST API for the GradeBook application, handling sign-in, schools, courses and their content, assignments and quizzes, the gradebook, attendance, files, messaging and the student portal.

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
│   ├── student/               # Student records (the school roster)
│   ├── student-account/       # School join codes, duplicate-record merging
│   ├── email-domain/          # School email domains (verified by DNS), join by domain
│   ├── course/                # Courses, people, join codes, modules, pages; CourseAccessService (course roles)
│   ├── grading/               # Activities (quiz/assignment/offline), submissions, assignment groups, gradebook
│   ├── attendance/            # Check-in sessions, codes, rotating QR, live SSE, absentee sweep
│   ├── notifications/         # Push devices + Expo push
│   ├── course-notification/   # Notices to students on new work/announcements (in-app + push)
│   ├── calendar/              # Due-date calendar for staff and students, .ics export
│   ├── student-portal/        # /portal/me - the student's own courses, work and grades
│   ├── dashboard/             # Staff dashboard summary
│   ├── grade-scale/           # Grade scales and bands (percentage -> letter)
│   ├── permission/            # Permission catalog, custom roles, PermissionGuard
│   ├── announcement/          # School-wide announcement board + read receipts
│   ├── discussion/            # Course discussion topics, threaded replies, unread tracking
│   ├── file-manager/          # Personal files, folders, sharing (user/role/course), notifications
│   ├── chat/                  # Real-time DMs (SSE + Redis pub/sub) + system messages
│   ├── images/                # Avatar upload service (direct + presigned PUT) and public avatar route
│   ├── queue/                 # BullMQ file pipeline: ingest, share-notify
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
├── AcademicYearModule, TermModule, GradeScaleModule, PermissionModule
├── StudentModule, StudentAccountModule, EmailDomainModule
├── SsoCoreModule (global - adapter registry), SsoModule
├── CourseAccessModule (global - CourseAccessService), CourseModule
├── GradingModule (exports SubmissionService, GradebookService)
├── AttendanceModule, NotificationsModule
├── CourseNotificationModule (global - notices on new work/announcements), CalendarModule
├── StudentPortalModule, DashboardModule
├── AnnouncementModule (announcement board + read receipts)
├── DiscussionModule (course discussions: staff + portal routes)
├── FileManagerModule (personal files, sharing, notifications)
├── RealtimeModule (global - exports RedisPubSubService + PresenceService; Redis pub/sub bus + online-presence tracking)
├── ChatModule (global - real-time DMs over SSE + Redis pub/sub; exports ChatSystemService)
├── QueueModule (global - BullMQ file ingest/share-notify with inline fallback)
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
| `account` | `app_user`, `session`, `email_code`, `identity` (own auth and linked SSO identities) |
| `public` | `user_profile`, `school`, membership and roles, `permission_catalog`, `academic_year`, `term`, `announcement`, `announcement_read`, `school_email_domain`, `push_device` |
| `student` | `student`, `school_join_code`, `parent_student_link` |
| `course` | `course`, `course_staff`, `course_student`, `assignment_group`, `module`, `module_item`, `page`, `attendance_session`, `attendance_record`, `course_notification`, `discussion_topic`, `discussion_reply`, `discussion_read`, `discussion_setting` |
| `grading` | `activity`, `quiz_question`, `quiz_option`, `quiz_answer`, `submission`, `grade_scale`, `grade_scale_band` |
| `file_manager` | `file`, `file_share`, `notification`, `folder` |
| `chat` | `conversation`, `conversation_member`, `message` |

## Guards

| Guard | Location | Behavior |
|-------|----------|----------|
| `ThrottlerGuard` | Global (APP_GUARD) | Rate limits all endpoints |
| `VersioningGuard` | Global (APP_GUARD) | Validates `X-API-Version` header; rejects invalid/non-existent versions with 400 |
| `AuthGuard` | `auth/auth.guard.ts` | Resolves the `gb_session` cookie via `SessionService` (renewing the sliding 30-day expiry when due) and rejects deactivated accounts; populates `request.user` with `{ id, email }` |
| `PermissionGuard` | `permission/permission.guard.ts` | School-level catalog permission from `@RequirePermission` (resolves the school from `:courseId` or the user's school) |
| `StudentGuard` | `student-portal/student.guard.ts` | Student accounts only; pins `req.student` to the caller's own record |

Inside a course, access is decided by `CourseAccessService` (course role: admin, teacher, TA; or an active student for portal routes), not by a guard.

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
