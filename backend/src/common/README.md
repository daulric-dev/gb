# Common helpers (`src/common`)

Small helper functions shared by many backend services. This folder is not a Nest module: nothing is registered or injected, files are imported directly with `@/common/...`. It holds converters that keep API responses in the JSON shapes clients expect now that the data layer is Prisma, and a lookup for the school a user is currently working in.

## What it provides

### `db-values.ts`

Prisma returns `Date` for date and timestamp columns, `Decimal` for numerics and `bigint` for bigints. Sent unchanged, these would alter the wire format (a `date` column would become a full timestamp, a numeric a string, and a bigint would throw during serialization), so services pass values through these helpers:

| Export | What it does |
|--------|--------------|
| `dateOnly(value)` | A Postgres `date` column as `"YYYY-MM-DD"`, or `null`. |
| `isoDate(value)` | A timestamp column as an ISO string, or `null`. |
| `num(value)` | A numeric / decimal / bigint / string as a JS `number`, or `null`. |
| `isUniqueViolation(err)` | True for Prisma `P2002` or Postgres SQLSTATE `23505`. |
| `isForeignKeyViolation(err)` | True for Prisma `P2003` or SQLSTATE `23503`. |
| `isNotFound(err)` | True for Prisma `P2025` (update/delete of a missing row). |
| `pgCode(err)` | The Postgres SQLSTATE behind an error, including errors from `$queryRaw` and driver-adapter errors where Prisma wraps the database error. |
| `raisedMessage(err)` | The text of an error plus its `meta`, so a message raised by a SQL function (`RAISE EXCEPTION 'no_attempts_left'`) can be matched and mapped to an HTTP error. |

### `http-query.ts`

HTTP `QUERY` support for the search and filter lists (see [docs/content/backend/http-query.md](../../../docs/content/backend/http-query.md)).

| Export | What it does |
|--------|--------------|
| `QUERY_METHOD` | `'QUERY'`. |
| `CORS_METHODS` | The methods CORS allows (`GET`, `QUERY`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`); `createApp.ts` passes it to `enableCors`. QUERY is not CORS-safelisted, so browsers preflight it. |
| `acceptEmptyQueryBodies(fastify)` | A `preParsing` hook: an empty QUERY body (no `Content-Type`, or a JSON one) is parsed as `{}`, so "no filters" reaches the handler as an empty DTO instead of Fastify's 400 for a QUERY without `Content-Type` or an empty JSON body. Other methods and non-empty bodies are untouched. |

`http-query.test.ts` checks every converted route (QUERY metadata, `@Body()` DTO, empty-body defaults, 400s) and, through `fastify.inject`, that a QUERY body reaches a handler, that an empty one is every default, that the old GET is a 404 and that the CORS preflight allows QUERY.

### `user-school.ts`

| Export | What it does |
|--------|--------------|
| `userSchoolId(prisma, userId)` | Reads `user_profile.school_id` for a user and returns it or `null`. Callers that require a school turn `null` into their own "not assigned to a school" error. |

## Used by

`db-values.ts` is imported by: `academic-year/academic-year.rows.ts`, `account/account.service.ts`, `announcement/announcement.service.ts`, `attendance/attendance.service.ts`, `calendar/calendar.service.ts`, `chat/chat.service.ts`, `course-notification/course-notification.service.ts`, `course/access/course-access.service.ts`, `course/course.service.ts`, `course/module.service.ts`, `course/page.service.ts`, `dashboard/dashboard.service.ts`, `discussion/discussion.service.ts`, `email-domain/email-domain.service.ts`, `file-manager/file-manager.service.ts`, `file-manager/file-share.service.ts`, `file-manager/folder.service.ts`, `grade-scale/grade-scale.service.ts`, `grading/assignment-group.service.ts`, `grading/submission.service.ts`, `organisation/organisation.service.ts`, `permission/permission.service.ts`, `student-account/student-membership.service.ts`, `student-portal/student-portal.service.ts`, `student/student.rows.ts`, `student/student.service.ts`, `term/term.rows.ts`, `term/term.service.ts`.

`user-school.ts` is imported by: `calendar/calendar.service.ts`, `chat/chat.controller.ts`, `chat/chat.service.ts`, `course/course-copy.service.ts`, `course/course.service.ts`, `dashboard/dashboard.service.ts`, `email-domain/email-domain.service.ts`, `file-manager/file-manager.service.ts`, `file-manager/folder.service.ts`, `permission/permission.service.ts`, `student/student.service.ts`, `term/term.service.ts`.

`http-query.ts` is imported by `createApp.ts`.

Nothing outside `backend/src` uses these files.

## Depends on

- `Prisma` (error classes and `Decimal` type) from `@/generated/prisma/client`.
- The `PrismaService` type (passed in by the caller to `userSchoolId`).

## Data

`userSchoolId` reads `public.user_profile` (`prisma/schema/school.prisma`). `db-values.ts` touches no tables.

## Configuration

None.

## Files

| File | Purpose |
|------|---------|
| `db-values.ts` | Response value converters and Prisma/Postgres error-code helpers. |
| `user-school.ts` | `userSchoolId` lookup of the caller's current school. |
| `school-membership.ts` | `setSchoolMembership(tx, userId, schoolId, role)`: create or update a `school_management` row without Prisma `upsert` (the partial one-admin-per-school index makes its ON CONFLICT fail with 42P10). Used by organisation appoint-admin and join-request approval. |
| `db-values.test.ts`, `user-school.test.ts` | Unit tests (see Tests). |

## Tests

```bash
cd backend && bun test src/common
```

- `db-values.test.ts` - `dateOnly` (UTC day, null/undefined, invalid `Date` throws), `isoDate`, `num` (Decimal, bigint, numeric string, zero kept, non-numeric becomes `NaN`), `isUniqueViolation` / `isForeignKeyViolation` (Prisma `P2002`/`P2003`, SQLSTATE in `meta.code`, driver-adapter `originalCode`, plain pg errors, and that a `P2002`-coded object that is not a Prisma error is ignored), `isNotFound` (only a real Prisma `P2025`), `pgCode` precedence and SQLSTATE-shape filtering, and `raisedMessage` formatting.
- `user-school.test.ts` - `userSchoolId` returns the profile's school, `null` for no profile or no school, passes the query shape, and propagates database errors.

## Adding a helper

Put a helper here only when it has no Nest dependencies and at least two modules need it. Anything that needs injection belongs in a module instead.

## See also

- [config README](../config/README.md)
- [Backend overview](../../../docs/content/backend/overview.md)
