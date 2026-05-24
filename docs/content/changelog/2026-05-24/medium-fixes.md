---
sidebar_label: 2026-05-24 · Medium-severity fixes
sidebar_position: 5
---

# 2026-05-24 — Medium-severity fixes

Third batch from the same audit. No new migrations — everything is application code or nginx config.

## Tighter rate limit on OTP send / verify / account-delete

Previously the only throttler was the global `default: 100/min per IP` defined in [app.module.ts](../../../../backend/src/app.module.ts), which let an attacker hammer `POST /auth/otp/send` 100 times per minute per IP. With email rotation that's an SMS/email-bomb vector and a brute-force enabler for the OTP verify endpoint.

**Fix.** Added a second named throttler `auth-strict` in [app.module.ts](../../../../backend/src/app.module.ts) that keys by the request body's `email` (lowercased) when present, falling back to IP. Applied via `@Throttle` decorators on the sensitive routes in [auth.controller.ts](../../../../backend/src/auth/auth.controller.ts):

| Route | Bucket | Limit |
|-------|--------|-------|
| `POST /auth/otp/send` | `auth-strict` by email | 5 / hour |
| `POST /auth/otp/verify` | `auth-strict` by email | 10 / 15 min |
| `DELETE /auth/account` | `default` by IP | 3 / hour |

Per-email keying means an attacker can't drain a victim's allowance by rotating IPs. The default IP throttler still applies on top as a coarser ceiling.

## `enrollment.enroll` and `bulkEnroll` school mismatch

`ClassTeacherGuard` restricted *who* could call enroll, but a class teacher in school A could pass any `studentId` from school B in the body — there was no check that the student actually belonged to the class's school. Combined with the IDOR fixes from the [critical batch](./security-fixes.md), this closes the last cross-school write path through enrollment.

**Fix.** New private helper [`EnrollmentService.assertSameSchool`](../../../../backend/src/enrollment/enrollment.service.ts) resolves the class's school via `student_group → academic_year → school_id`, then verifies every supplied `studentId` belongs to the same school. `enroll` and `bulkEnroll` call it before the insert. Mismatches throw `BadRequestException` with `"Students must belong to the same school as the class"`. Non-existent students throw `"One or more students do not exist"`.

A new test covers the cross-school rejection case.

## Search-term injection / DoS in `student.service`

`findAll` and `findAllPaginated` interpolated the `search` query param directly into a PostgREST `.or()` filter:

```ts
.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`)
```

Cross-school exfiltration was already blocked by the AND'd `school_id` filter, but the syntax characters (`,()*`) and ilike wildcards (`%_`) could be used to break out of the intended filter shape and to force expensive leading-wildcard scans for DoS.

**Fix.** Added `sanitizeSearchTerm` at the top of [student.service.ts](../../../../backend/src/student/student.service.ts) that strips `,`, `(`, `)`, `*`, `%`, `_`, and `\`, trims, and caps at 64 characters. Both `findAll` and `findAllPaginated` route the user input through it; an empty result after sanitization skips the filter entirely.

```ts
function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[,()*%_\\]/g, '').trim().slice(0, 64);
}
```

A grep across the rest of the backend confirms this is the only `.or()` interpolation pattern with user input.

## `leaveSchool` data hygiene

[`SchoolService.leaveSchool`](../../../../backend/src/school/school.service.ts) deleted the user's `school_management` row and cleared their `user_profile.school_id`, but left any pending `school_join_request` rows untouched. Combined with the orphan-school bootstrap rule, this opened a stale-data path: a user with a pending request to school B who joined and left school A would, on their next `createJoinRequest` call, slip through with the old pending row.

**Fix.** `leaveSchool` now also deletes the user's `pending` join-request rows in a separate statement after the membership delete. Cancelled / approved / rejected requests are preserved as audit trail.

## Removed unused `@supabase/supabase-js` from the frontend

The frontend never imports `@supabase/supabase-js` — all Supabase calls go through the NestJS backend. Carrying the dep meant a non-trivial bundle bloat and a footgun: a future contributor could reach for it and accidentally bypass the auth layer the rest of the app uses.

**Fix.** Removed from [frontend/package.json](../../../../frontend/package.json) `dependencies`. Run `bun install` (or your package manager's equivalent) after pulling to clean the lockfile.

## CSP header on nginx

The [High batch](./high-fixes.md#nginx-hardening) added `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy` to [nginx default.conf](../../../../infrastructure/nginx/default.conf). This batch adds Content-Security-Policy.

The CSP here covers the **API surface only** — nginx proxies the NestJS backend, whose responses are JSON, Swagger UI, and error pages. None of that needs to embed cross-origin content. The frontend's CSP should be configured separately in `next.config.ts` where it can be tuned to the actual asset origins (Supabase storage, etc.).

```
Content-Security-Policy:
  default-src 'none';
  frame-ancestors 'none';
  base-uri 'none';
  form-action 'self';
  img-src 'self' data:;
  script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  connect-src 'self'
```

`'unsafe-inline'` on `script-src` and `style-src` is concession to Swagger UI; everything else is locked down. `frame-ancestors 'none'` duplicates `X-Frame-Options: DENY` for browsers that don't respect the latter.

## Tests

- New enrollment test: `enroll > rejects when student is in a different school`.
- Existing enroll/bulkEnroll tests updated to mock the school-check helper via a shared `withSchoolChecks` wirer.
- Full suite: **102 passing** (up from 101).

## Deploy order

No database migrations in this batch. Order:

1. Deploy backend.
2. Reload nginx (`nginx -t && nginx -s reload`) or rebuild the container.
3. Frontend rebuild to drop the unused dep from the bundle (functional no-op but worth doing).

## Still open from the same audit

These are Low and not in this batch:

- `BulkGradeDto` has no `@ArrayMaxSize` and `score` has no `@Max` — unbounded payloads.
- `worker.ts` Cloudflare entrypoint doesn't register `@fastify/cookie` — only matters if that entrypoint is ever used.
- `docker-compose.yml` mounts the nginx config from a wrong relative path → container would boot with stock default config exposing the welcome page.
- OTP verify auto-submits on paste in the frontend.
- Onboard/pending page double-decodes `searchParams.get('school')`.
- `X-Server-Port` debug header in `main.ts`.
- Service client mixed with user client in some report.service paths (defense-in-depth only, not exploitable on its own).
