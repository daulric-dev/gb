# Common helpers (`src/common`)

Small helper functions shared by many backend services, plus the global exception filter. This folder is not a Nest module: nothing is injected, files are imported directly with `@/common/...`. It holds converters that keep API responses in the JSON shapes clients expect now that the data layer is Prisma, and a lookup for the school a user is currently working in.

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

### `csrf.ts`

Cross-site request forgery protection, installed by `createApp.ts`. The `gb_session` cookie is `SameSite=Lax` on a parent domain, so a page on any sibling subdomain is same-site and its form posts carry the cookie.

| Export | What it does |
|--------|--------------|
| `registerCsrfProtection(fastify)` | An `onRequest` hook (after `@fastify/cookie`, before body parsing and guards). A non-GET/HEAD/OPTIONS/QUERY request whose session would come from the cookie (`sessionTokenVia(req) === 'cookie'`) must carry an `Origin` - or, when that is missing, a `Referer` whose origin - is in `allowedOrigins()` (or a LAN origin outside production, as for CORS). Otherwise `403 { statusCode, message: CSRF_REJECTION_MESSAGE, error: 'Forbidden' }`; a missing origin and `Origin: null` are refused too. Not checked: requests without a session cookie, the native app (`Authorization: Bearer` or `X-GradeBook-Client: native` - custom headers a cross-site page cannot send without a CORS preflight that only our origins pass), and `CSRF_EXEMPT_PATHS` (the SAML ACS, which an IdP posts to cross-site and which ignores the session cookie, and the LTI OIDC auth endpoint `/api/lti/auth`, which an external tool's page posts to and which is authorised by a single-use launch ticket, see `src/lti`). There are no inbound webhooks to exempt. |
| `csrfViolation(req)` | The pure rule above: the reason to refuse, or `null`. |
| `requestSourceOrigin(req)` / `requestPath(url)` | `Origin`, else the `Referer`'s origin; a URL's path without query or trailing slash. |
| `useBodyParsers(app)` | Replaces Nest's default body parsers before `init()`: JSON exactly as Nest registers it, and `application/x-www-form-urlencoded` through `formBodyParser`. |
| `formBodyParser` | Parses form bodies only on `FORM_BODY_PATHS`: `SAML_ACS_PATH` (`/api/auth/sso/saml/acs`) and the LTI auth and token endpoints (`/api/lti/auth`, `/api/lti/token`); anywhere else answers 415. `useBodyParsers` also parses the LTI AGS media types (`application/vnd.ims.lis.v1.score+json`, `…v2.lineitem+json`) as JSON, only under `/api/lti/ags/`; so a plain cross-site HTML form (no preflight) cannot reach a JSON route at all. |

`csrf.test.ts` (through `fastify.inject` on a small Nest app) covers an allowed origin, a foreign origin, a missing or `null` origin with a cookie, the `Referer` fallback, the native app's bearer token (and its cookie jar replaying a cookie), requests without a cookie and safe methods, the SAML ACS exemption and form parsing there, 415 for form bodies elsewhere, and JSON parsing unchanged (including prototype-poisoning 400s).

### `exception.filter.ts`

The app's global exception filter, registered in `createApp.ts` with `app.useGlobalFilters(new AppExceptionFilter(app.getHttpAdapter()))`. Clients must never see stack traces, Prisma or SQL text, or file paths.

| Export | What it does |
|--------|--------------|
| `AppExceptionFilter` | `HttpException`s (validation 400s, throttler 429s, 404s from routing, custom bodies such as `FEATURE_DISABLED`, `STEP_UP_REQUIRED`, `update_required`) go through Nest's default handling unchanged, as do 4xx errors from Fastify or `http-errors` (bad JSON, body too large). Anything else is logged in full (`[errorId] METHOD /path failed` plus the stack, context `ExceptionsHandler`) and answered `500 { statusCode: 500, message: GENERIC_ERROR_MESSAGE, errorId }`. A response already sent (SSE, `@Res()` routes that hijacked the reply) is only ended. |
| `GENERIC_ERROR_MESSAGE` | `'Something went wrong. Please try again.'` |
| `newErrorId()` | 8 hex characters; quote it to find the log line. |

Services must not build an `HttpException` from raw error text (`err.message`, `String(err)`): log the detail and throw a fixed, human message.

### `user-school.ts`

| Export | What it does |
|--------|--------------|
| `userSchoolId(prisma, userId)` | Reads `user_profile.school_id` for a user and returns it or `null`. Callers that require a school turn `null` into their own "not assigned to a school" error. |

## Used by

`db-values.ts` is imported by: `academic-year/academic-year.rows.ts`, `account/account.service.ts`, `announcement/announcement.service.ts`, `attendance/attendance.service.ts`, `calendar/calendar.service.ts`, `chat/chat.service.ts`, `course-notification/course-notification.service.ts`, `course/access/course-access.service.ts`, `course/course.service.ts`, `course/module.service.ts`, `course/page.service.ts`, `dashboard/dashboard.service.ts`, `discussion/discussion.service.ts`, `email-domain/email-domain.service.ts`, `file-manager/file-manager.service.ts`, `file-manager/file-share.service.ts`, `file-manager/folder.service.ts`, `grade-scale/grade-scale.service.ts`, `grading/assignment-group.service.ts`, `grading/submission.service.ts`, `organisation/organisation.service.ts`, `permission/permission.service.ts`, `student-account/student-membership.service.ts`, `student-portal/student-portal.service.ts`, `student/student.rows.ts`, `student/student.service.ts`, `term/term.rows.ts`, `term/term.service.ts`.

`user-school.ts` is imported by: `calendar/calendar.service.ts`, `chat/chat.controller.ts`, `chat/chat.service.ts`, `course/course-copy.service.ts`, `course/course.service.ts`, `dashboard/dashboard.service.ts`, `email-domain/email-domain.service.ts`, `file-manager/file-manager.service.ts`, `file-manager/folder.service.ts`, `permission/permission.service.ts`, `student/student.service.ts`, `term/term.service.ts`.

`http-query.ts`, `csrf.ts` and `exception.filter.ts` are imported by `createApp.ts`.

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
| `time-zone.ts` | Wall-clock time in a school's IANA zone with `Intl` only: `isValidTimeZone`, `safeTimeZone` (UTC fallback), `localParts(instant, tz)` (local date, minute, ISO weekday), `zonedToUtc(date, minute, tz)` (a skipped time lands after the gap, a repeated one is its first occurrence), and zone-free day arithmetic (`addDays`, `daysBetween`, `isoWeekday`, `isIsoDate`, `toDbDate`). Used by `src/timetable` and `src/attendance-alerts`; tested in `time-zone.test.ts` (DST in London and New York). |
| `user-school.ts` | `userSchoolId` lookup of the caller's current school. |
| `exception.filter.ts` | `AppExceptionFilter`: generic 500s with an error id for unknown errors. |
| `csrf.ts` | Origin check for cookie-authenticated writes; JSON and SAML-only form body parsers. |
| `school-membership.ts` | `setSchoolMembership(tx, userId, schoolId, role)`: create or update a `school_management` row without Prisma `upsert` (the partial one-admin-per-school index makes its ON CONFLICT fail with 42P10). Used by organisation appoint-admin and join-request approval. |
| `db-values.test.ts`, `user-school.test.ts`, `exception.filter.test.ts` | Unit tests (see Tests). |

## Tests

```bash
cd backend && bun test src/common
```

- `db-values.test.ts` - `dateOnly` (UTC day, null/undefined, invalid `Date` throws), `isoDate`, `num` (Decimal, bigint, numeric string, zero kept, non-numeric becomes `NaN`), `isUniqueViolation` / `isForeignKeyViolation` (Prisma `P2002`/`P2003`, SQLSTATE in `meta.code`, driver-adapter `originalCode`, plain pg errors, and that a `P2002`-coded object that is not a Prisma error is ignored), `isNotFound` (only a real Prisma `P2025`), `pgCode` precedence and SQLSTATE-shape filtering, and `raisedMessage` formatting.
- `exception.filter.test.ts` - through `fastify.inject`: a `TypeError`, Prisma text and a thrown string become the generic 500 with an `errorId` that appears in the log; `HttpException`s, `FEATURE_DISABLED` / `STEP_UP_REQUIRED` / `update_required` bodies, throttler 429s and validation 400s are unchanged; route 404s, bad JSON (400) and too-large bodies (413) keep their status; a hijacked response is ended, not rewritten.
- `user-school.test.ts` - `userSchoolId` returns the profile's school, `null` for no profile or no school, passes the query shape, and propagates database errors.

## Adding a helper

Put a helper here only when it has no Nest dependencies and at least two modules need it. Anything that needs injection belongs in a module instead.

## See also

- [config README](../config/README.md)
- [Backend overview](../../../docs/content/backend/overview.md)
