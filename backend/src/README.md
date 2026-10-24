# Backend source (`backend/src`)

The NestJS application. One folder per domain module, following Nest conventions (`<name>.module.ts`, `<name>.controller.ts`, `<name>.service.ts`, `dto/`, tests as `<name>.test.ts` next to the code), plus a few shared folders and the entry points at the root. Imports use the `@/` alias for `src/` (set in `tsconfig.json`), e.g. `import { PrismaService } from '@/prisma/prisma.service'`.

Every folder below has its own README with its routes, exports, consumers, tables and env vars.

## Root files

| File | What it does |
| --- | --- |
| `app.module.ts` | The root module. Imports every feature module, configures `ConfigModule` (global) and `ThrottlerModule` with four named throttlers (`default`, `auth-strict`, `auth-ip`, `claim-code` - see [throttle/README.md](./throttle/README.md)), and registers two global guards: `ThrottlerGuard` and `VersioningGuard`. `QueueModule` is imported as `QueueModule.forRoot()`, which picks Redis or inline mode. |
| `createApp.ts` | Builds the Nest app on Fastify; `main.ts` is its only caller. Sets Fastify `trustProxy` from `TRUST_PROXY_HOPS` (default 1); registers `@fastify/cookie`, the billing webhook raw-body hook (`billing/raw-body.ts`) and `@fastify/multipart` (10 MB file limit); mounts Swagger at `/docs` when `NODE_ENV !== 'production'`; sets the global prefix `api`; installs the global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`); adds two raw Fastify routes outside the prefix - `GET /` (`gb`) and `GET /health` (`ok`); and enables CORS for origins allowed by `config/origins.ts` with credentials, the `X-API-Version` header and an exposed `Content-Disposition`. Calls `app.init()` but not `listen()`. |
| `main.ts` | The server entry point: `createApp()` then `listen(PORT ?? 3001, '0.0.0.0')`. Used by `bun run start:dev` (`bun --watch src/main.ts`), `start:prod`, and the container image (`bun dist/src/main`), which is the supported deployment. |
| `app.controller.ts` | `GET /api` - returns `AppService.getHello()`. |
| `app.service.ts` | `getHello()` returns `'Hello World!'`. |
| `app.service.test.ts` | Test for `AppService`. |

## Request flow

1. **Fastify** parses the request: cookies, multipart, and for billing webhooks the raw body. CORS is applied.
2. **Global guards** run on every route: `ThrottlerGuard` (rate limits) then `VersioningGuard` (rejects a bad `X-API-Version`).
3. **Route guards** declared with `@UseGuards(...)`: usually `AuthGuard` (resolves the `gb_session` cookie into `req.user`; from [auth](./auth/README.md)) followed by one of `PermissionGuard` + `@RequirePermission(resource, action)` ([permission](./permission/README.md)), `AdminGuard` ([auth](./auth/README.md)), `StudentGuard` ([student-portal](./student-portal/README.md)) or the billing guards. Course routes check course roles inside the service with `CourseAccessService` ([course](./course/README.md)).
4. **Global interceptor** `BillingEntitlementInterceptor` (registered by [billing](./billing/README.md) as `APP_INTERCEPTOR`): when `BILLING_ENABLED=true`, refuses mutations with 402 for members of a school whose subscription has lapsed. It is an interceptor so that it runs after `AuthGuard` has identified the user.
5. **Pipes**: the global `ValidationPipe` validates and transforms DTOs; some routes add `ParseUUIDPipe`.
6. **Controller** -> **service** -> **`PrismaService`** (Postgres) and the other shared services (cache, storage, mail, queue, realtime). Some controllers pass the result through `VersioningService.resolve()`.

There is no row-level security in the database: guards and service code are the only access rules, and every query must scope itself to the caller's school (usually `user_profile.school_id`).

## Folders

| Folder | What it is |
| --- | --- |
| [academic-year](./academic-year/README.md) | Academic years: create, list, update, and activate / deactivate the active year. |
| [account](./account/README.md) | Our own authentication (global): users, sessions (`gb_session` cookie), email sign-in codes and their mail templates. |
| [announcement](./announcement/README.md) | School-wide announcements with read receipts, and course announcements. |
| [attendance](./attendance/README.md) | Course attendance: check-in sessions, codes and rotating QR, student self check-in, live SSE feed; students who have not checked in when a session closes are marked absent. |
| [auth](./auth/README.md) | Auth HTTP routes (email code sign-in, `me`, onboarding, join school by code, profile, avatar, logout), `AuthGuard` and `AdminGuard`. |
| [billing](./billing/README.md) | Hosted-platform billing (off unless `BILLING_ENABLED=true`): plans, subscriptions, invoices, payment providers, webhooks, platform admin dashboard, the entitlement interceptor. |
| [cache](./cache/README.md) | Global `CacheService` over a pluggable store (memory or Redis). |
| [calendar](./calendar/README.md) | Due-date calendars for staff and students, with `.ics` export. |
| [chat](./chat/README.md) | Direct messages over SSE with Redis fan-out, presence, system messages, encryption at rest (global module). |
| [common](./common/README.md) | Shared helpers: database value conversion (`db-values.ts`) and the caller's school (`user-school.ts`). |
| [config](./config/README.md) | Allowed browser origins (`origins.ts`) from `FRONTEND_URL`. |
| [course](./course/README.md) | Courses, people and join codes, modules, pages, course files, copy and templates; `access/` holds the global `CourseAccessService` (course roles). |
| [course-notification](./course-notification/README.md) | In-app and push notices to students about new work, announcements and discussions (global). |
| [dashboard](./dashboard/README.md) | Staff dashboard summary (`GET /api/dashboard/summary`). |
| [discussion](./discussion/README.md) | Course discussion topics, threaded replies and unread tracking, for staff and the portal. |
| [email-domain](./email-domain/README.md) | School email domains verified by DNS, joining a school by domain, per-domain SSO settings. |
| [file-manager](./file-manager/README.md) | Personal files and folders, sharing with users, roles and courses, upload tickets, share notifications. |
| `generated` | The Prisma client generated from `prisma/schema` (`bun run db:generate`). Gitignored; import it as `@/generated/prisma/client`. |
| [grade-scale](./grade-scale/README.md) | Grade scales and bands (percentage to letter). |
| [grading](./grading/README.md) | Activities (quiz, assignment, offline), submissions, assignment groups, rubrics, gradebook and CSV import. |
| [images](./images/README.md) | Avatar uploads (direct and presigned) and the public avatar route. |
| [mail](./mail/README.md) | Global `MailService` over SMTP (nodemailer). |
| [notifications](./notifications/README.md) | Push device registration and Expo push delivery. |
| [pagination](./pagination/README.md) | Shared DTO and result type for offset and cursor pagination (`PaginationQueryDto`, `PaginatedResult`). |
| [permission](./permission/README.md) | Permission catalog, custom school roles, `PermissionGuard` and `@RequirePermission`. |
| [prisma](./prisma/README.md) | Global `PrismaService`: Prisma 7 with the `pg` driver adapter. |
| [queue](./queue/README.md) | Background job for file share notifications on BullMQ, or inline without Redis. |
| [realtime](./realtime/README.md) | Redis (or in-process) pub/sub bus and presence tracking for SSE features. |
| [school](./school/README.md) | Schools, staff membership, join requests, members. |
| [sso](./sso/README.md) | Single sign-on with our own OpenID Connect (Google, Microsoft) and SAML; adapter registry. |
| [storage](./storage/README.md) | Global `StorageService` for S3-compatible object storage and presigned URLs. |
| [student](./student/README.md) | The staff view of the student roster: list, search, paginate, profile, create, update. |
| [student-account](./student-account/README.md) | The school join code students redeem, and merging duplicate student records. |
| [student-portal](./student-portal/README.md) | `/api/portal/me`: the student's own record, courses, work and grades; `StudentGuard`. |
| [term](./term/README.md) | Terms within an academic year. |
| [test](./test/README.md) | Unit-test helpers: `createMockPrisma()`, an in-memory cache, billing fakes, a fake SAML IdP. |
| [throttle](./throttle/README.md) | Rate-limit trackers (client IP and session buckets) used by `app.module.ts`. |
| [versioning](./versioning/README.md) | `X-API-Version` response versioning: service, global guard, transformer registry. |

## Global modules

These are `@Global()`, so any module can inject their exports without importing them: `PrismaModule`, `StorageModule`, `MailModule`, `AccountModule`, `CacheModule`, `QueueModule`, `VersioningModule`, `CourseAccessModule`, `SsoCoreModule`, `RealtimeModule`, `ChatModule`, `CourseNotificationModule`.

## See also

- [../README.md](../README.md) - running the backend.
- [docs/content/backend/overview.md](../../docs/content/backend/overview.md)
