---
sidebar_label: 2026-05-24 · Low-severity fixes
sidebar_position: 6
---

# 2026-05-24 - Low-severity fixes

Final cleanup batch from the audit. Small, mostly-isolated changes; no migrations, no behavior changes for normal users.

## `BulkGradeDto` had no payload bounds

[bulk-grade.dto.ts](../../../../backend/src/grading/dto/bulk-grade.dto.ts) accepted unbounded `grades[]` and unbounded `score` per entry. A single request could submit millions of grade entries or 1e300 scores and tie up the worker / blow past sensible row limits.

**Fix.** Added:

- `@ArrayMaxSize(1000)` on `grades` - matches a comfortable upper bound for class size × bulk operations.
- `@Max(1000)` on `GradeEntry.score` - grades are nominally 0–100, 1000 leaves room for any future scoring scheme without being a footgun.
- `@MaxLength(2000)` on `GradeEntry.remarks` - caps free-text remarks.

`ArrayMinSize(1)` and `Min(0)` were already present.

## Removed `X-Server-Port` debug header from `main.ts`

[main.ts](../../../../backend/src/main.ts) was setting `X-Server-Port: <PORT>` on every response and `console.log`ging the local port per request. Both are debug artifacts that leaked the per-instance port behind the load balancer and spammed logs in production.

**Fix.** Removed the entire debug middleware block.

## `docker-compose.yml` mounted nginx config from a wrong path

[infrastructure/docker-compose.yml](../../../../infrastructure/docker-compose.yml) was at `infrastructure/docker-compose.yml` but mounted `./infrastructure/nginx/default.conf` - which resolves relative to the compose file's directory, so it tried to read `infrastructure/infrastructure/nginx/default.conf` (doesn't exist). The container would silently start with the stock default config, exposing the nginx welcome page on port 80.

**Fix.** Changed the volume to `./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro` (the path is now correct relative to the compose file, and the mount is read-only - defense in depth).

## `worker.ts` Cloudflare entrypoint missed `@fastify/cookie`

[worker.ts](../../../../backend/src/worker.ts) registers `@fastify/multipart` but not `@fastify/cookie`. The main entrypoint [createApp.ts](../../../../backend/src/createApp.ts) does register cookie. So the Cloudflare worker entrypoint would boot fine but silently drop every cookie the Supabase SSR adapter tries to set - sessions would never persist on this entrypoint.

**Fix.** Imported and registered `@fastify/cookie` in `worker.ts`, immediately before multipart, mirroring the order in `createApp.ts`.

This entrypoint may not be in active use today (the production deploy uses a different runtime), but having a broken alternate entrypoint sitting in the tree is a foot-shooter waiting for a future "let's try Workers" decision.

## Verify-OTP page auto-submitted on paste

[app/login/verify/page.tsx](../../../../frontend/app/login/verify/page.tsx) called `handleSubmit` inside `onPaste` as soon as the pasted text was 8 characters. Combined with no client-side throttle (the [Medium batch](./medium-fixes.md#tighter-rate-limit-on-otp-send--verify--account-delete) adds server-side throttling), a clipboard-watcher script or a stray paste of a non-OTP 8-char string would trigger a verify attempt without the user clicking anything.

**Fix.** `onPaste` now just strips non-digit characters, caps at 8, and sets the input value. The user must explicitly click **Verify**.

## Onboard pending page double-decoded `searchParams.get('school')`

[app/onboard/pending/page.tsx](../../../../frontend/app/onboard/pending/page.tsx) read `params.get('school')` and then applied `decodeURIComponent` to the result. `URLSearchParams.get` already URL-decodes; the extra pass would throw on any `%` literal in the school name and would double-decode percent-encoded characters elsewhere (e.g. `%2520` → `%20` instead of staying as `%20`).

**Fix.** Dropped the redundant `decodeURIComponent` call. The display value now matches what the browser sent.

## Tests

No new tests needed - the changes are config or input-validation tightening only.

- Backend: 102/102 passing.
- Frontend: pre-existing `bun:test` type-resolution errors in test files; none of the touched files (`app/login/verify/page.tsx`, `app/onboard/pending/page.tsx`) regressed.

## Deploy order

No database migrations. Order:

1. Backend deploy (picks up the new DTO bounds and removes the debug header).
2. Frontend rebuild (picks up the paste / double-decode fixes).
3. Reload nginx via `docker compose` - note that the `docker-compose.yml` path fix only matters if you run nginx through this compose file; if your production nginx is host-installed it's untouched.

## Belt-and-suspenders school check on report mutations

The audit also flagged `report.service.ts` for mixing the service client (RLS-bypassing) with the user client in nearby methods. The cleanest fix - switching the mutations to the user client and relying on RLS - would require new INSERT/UPDATE/DELETE policies on `reporting.report_book`, which is a larger change than the rest of this batch.

Instead, this batch closes the same defense-in-depth gap by **re-verifying report ownership in the service layer itself**. The `ClassTeacherGuard` (which became school-aware in the [High batch](./high-fixes.md#classteacherguard--verifyclassteacher-admin-bypass)) is still the primary gate, but a guard regression would no longer let a write slip through.

**Fix.** New private helper [`ReportService.assertReportInCallerSchool(reportId, userId)`](../../../../backend/src/reporting/report.service.ts) resolves the report's school via `report_book → academic_year → school_id`, fetches the caller's school via `SupabaseService.getUserSchoolId`, and throws `ForbiddenException('You cannot modify reports from another school')` on mismatch. Applied to the four mutating methods that use the service client:

- `updateReport(userId, reportId, dto)`
- `publish(userId, reportId)`
- `sendToMinistry(userId, reportId)`
- `regenerateReport(userId, reportId)`

Controllers now plumb `req.user.id` through to each ([report.controller.ts](../../../../backend/src/reporting/report.controller.ts)). Existing tests were updated to satisfy the new check; a new test confirms the cross-school rejection path returns 403. Suite is now 103 passing.

Everything from the audit (Critical / High / Medium / Low) is now closed.
