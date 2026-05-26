---
sidebar_label: Overview
sidebar_position: 1
---

# Changelog

Notable changes to the codebase, grouped by date.

Each entry below links to a dedicated page with the full writeup - what changed, why, what to deploy, and any behavior changes downstream consumers should know about.

## 2026-05-25

- [Attendance tracking](./2026-05-25/attendance-tracking.md) - new `student.attendance_record` table + RLS, `AttendanceModule` with mark/bulk-mark/update/delete and per-student range + summary reports, mark-attendance page under `/dashboard/classes/[classId]/attendance` with a per-student report dialog.
- [Custom grade scales](./2026-05-25/custom-grade-scales.md) - new `grading.grade_scale` + `grade_scale_band` tables (one-default-per-school via partial unique index), `GradeScaleModule` CRUD with admin-only writes, convert-on-read in `GradeService` so each grade returns `converted: { label, gpaPoints, isPass } | null`, admin settings page at `/dashboard/grade-scales`, and a band badge next to scores in the grading table.
- [Auth + dev ergonomics](./2026-05-25/auth-and-dev-ergonomics.md) - incidental work that landed alongside the features: `useProfile` rebuilt as an `AuthProvider` Context so the whole app shares one `/auth/me` fetch, `SupabaseService.getUser` made non-throwing so stale refresh tokens don't crash `AuthGuard`, dev `start` scripts switched to Bun (the `'bun'` module crash), and dev-only throttle limits bumped (1000/min default, 100/hour auth-strict) so hot reloads don't trip 429s. Production limits unchanged.
- [Per-session throttling](./2026-05-25/per-session-throttling.md) - `default` throttler now keys off the session (Bearer token, then `sb-*-auth-token` cookie, then IP fallback) instead of the request IP, fixing 429s in production where every user behind a given Next.js middleware instance shared one IP-keyed bucket. Tokens are hashed before storage. Limits unchanged.

## 2026-05-24

- [Critical security fixes](./2026-05-24/security-fixes.md) - five criticals from the repo audit: cross-school admin RLS bypass, `assignment_write` policy typo, IDOR in service-client endpoints, PDF upload arbitrary path, PDF download IDOR.
- [High-severity fixes](./2026-05-24/high-fixes.md) - follow-up batch: removed `schoolId` from profile-update DTO, school-scoped the `ClassTeacherGuard` admin bypass, added auth to `/calculations/student-*`, closed the first-admin race with a partial unique index, fixed avatar upload path injection, hardened nginx config.
- [Medium-severity fixes](./2026-05-24/medium-fixes.md) - third batch: per-email rate limit on OTP/account-delete, school-mismatch check on enrollment, search-input sanitization in student.service, `leaveSchool` clears stale join requests, removed unused `@supabase/supabase-js` from frontend, added CSP header to nginx.
- [Low-severity fixes](./2026-05-24/low-fixes.md) - final cleanup: `BulkGradeDto` payload bounds, removed `X-Server-Port` debug header, fixed `docker-compose.yml` nginx mount path, registered `@fastify/cookie` in the Cloudflare worker entrypoint, removed OTP-paste auto-submit, fixed double-decode on onboard/pending page.
- [Redis resilience against Upstash idle disconnects](./2026-05-24/redis-resilience.md) - `CacheService` swallows Redis errors and degrades gracefully; `RedisStore` keeps the connection alive with a 60s `PING`.
- [Infrastructure CI: Dockerfile & build workflow](./2026-05-24/infrastructure-ci.md) - added a multi-stage Bun Dockerfile for the backend, fixed the compose build context, and replaced the validation-only CI with three jobs (nginx syntax, `docker compose build`, mock-upstream reverse-proxy test) wired up through small scripts in `.github/scripts/`.
