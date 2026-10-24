---
sidebar_label: 2026-10-25 · Backend cleanup
sidebar_position: 1
---

# 2026-10-25 - Backend cleanup: unused services removed

Code that nothing called, deployment targets nobody used and permission keys
nothing checked are gone from the backend. A few small API behaviour changes come
with it (see Behaviour changes below).

## Deployment

- **The container is the only supported deployment**: `infrastructure/Dockerfile`
  builds the backend and runs `bun dist/src/main` (after
  `prisma migrate deploy`, unless `MIGRATE_ON_START=false`).
- Removed: the Vercel entry `backend/api/`, the Cloudflare Workers entry
  `backend/src/worker.ts` and its `backend/src/stubs/` alias module, the
  `vercel-build`, `deploy` and `deploy:staging` scripts, and the `wrangler`
  devDependency in `backend/package.json`.

## Removed code

- `PaginationService` and `PaginationModule`. `src/pagination` now holds only
  `pagination.dto.ts` (`PaginationQueryDto`, `PaginatedResult`); list endpoints
  already paginate with Prisma themselves.
- `GradeScaleService.convertScore()` - the gradebook works out letters with
  `letterFor()` in `src/grading/gradebook.calc.ts`.
- `SeatService.syncSchool()` - seat counts reach the payment provider only
  through the hourly `syncAll()`.
- `FolderService.findOrCreateSystemPath()` - only its tests called it.
- The **file-ingest queue**: `FileIngestHandler`, `FileIngestProcessor`,
  `QUEUE_FILE_INGEST`, `IngestJobData` and `FileQueueService.enqueueIngest()`.
  Nothing enqueued ingest jobs. The share-notify queue
  (`file-share-notify`) is the only one left.
- The empty `reporting` and `staff` schemas are no longer listed in
  `backend/prisma/schema/main.prisma`.

## Permissions

A catalog key now exists only when something enforces it. Removed:

| Key | Why |
| --- | --- |
| `course:read` | Reading a course is decided by the course role (`CourseAccessService`) |
| `course:delete` | Deleting a course is decided by the course role |
| `student:delete` | There is no route that deletes a student |
| `academic-year:delete` | There is no route that deletes an academic year |

`course` keeps `create` and `update`; `student` and `academic-year` keep
`create`, `read` and `update`. The teacher and member defaults no longer
include `course:read`. The catalog has 30 keys.

## Behaviour changes

- `PATCH /api/academic-years/:id` no longer accepts `isActive` (it was
  accepted and ignored; now it is a 400 like any unknown field). Use
  `PATCH /api/academic-years/:id/activate` or `/deactivate`.
- `GET /api/students` in cursor mode with an unknown `cursorColumn` (including
  inherited names such as `constructor`) answers **400**
  `cursorColumn must be one of: ...` instead of 500.
- The avatar upload routes (`POST /api/auth/avatar`, `/avatar/resumable`,
  `/avatar/complete`) act on the signed-in user (`req.user.id`, set by `AuthGuard`) instead of a
  user id read from the request body.

## Docs and config

- `backend/.env.example` shows the chat key ring in the format the code parses:
  `CHAT_ENCRYPTION_KEYS=1:<base64 key>,2:<base64 key>` and
  `CHAT_ENCRYPTION_KEY_VERSION=2` (a bare number).
- The sign-in code is documented as 8 digits (the Swagger example for
  `POST /api/auth/otp/verify` said 6).

## Bugs fixed

Found while writing the new unit tests:

- **Chat:** a sender could edit a deleted message and put a body back on it;
  editing a deleted message is now a 400.
- **Chat requests** (e.g. a file share awaiting accept/dismiss) could be answered
  again or answered after deletion; a second answer is now a 409 and a deleted
  request is a 400.
- **Auth cookie domain:** in production with `AUTH_COOKIE_DOMAIN` unset, an IP
  or single-label frontend origin (`http://10.0.0.5:3000`, `http://intranet`)
  produced an invalid cookie domain (`.0.5`) that browsers rejected, so nobody
  could stay signed in. Such hosts now get a host-only cookie.
- **Course access:** `requireStudent(..., {})` hid archived courses; the
  "archived stays readable" default now applies whenever `allowArchived` is
  not given.
- **Avatar uploads** use the signed-in user (`req.user.id`) instead of a user id
  read from the request body.
- `scripts/student-flow-check.ts` follows the current join-code and merge flow
  and cleans up everything it creates.

## Tests

About 270 new unit tests for `dashboard`, `common`, `config`, `course/access`,
`grade-scale` and `chat`, which had none.

## Deploying

- Migration `20261025100000_drop_unenforced_permissions` deletes the four keys
  from `public.permission_catalog`; grants to custom roles go with them
  (`school_role_permission` cascades). `bun run db:deploy`, or let the container
  apply it on start.
- No new environment variables. Anyone who deployed with Vercel or Wrangler
  must move to the container image.
