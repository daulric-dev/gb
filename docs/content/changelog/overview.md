---
sidebar_label: Overview
sidebar_position: 1
---

# Changelog

Notable changes to the codebase, grouped by date.

Each entry below links to a dedicated page with the full writeup - what changed, why, what to deploy, and any behavior changes downstream consumers should know about.

## 2026-06-25

- [Login redirect fix & middleware cleanup](./2026-06-25/login-redirect-and-middleware.md) - fixed the intermittent bounce back to `/login` after a successful OTP login: the root-layout `AuthProvider` fetches `/auth/me` once and persists, so after a soft navigation to `/dashboard` it still held the stale logged-out `profile` and the dashboard guard redirected; the verify page now `await`s `refresh()` before navigating. Also a no-behavior-change cleanup of `proxy.ts` (lazy path matching, deduped set-cookie tails).
- [Staff roles & permissions](./2026-06-25/staff-roles-and-permissions.md) - teachers now get `class:create` by default (create-class was admin-only), so they can create a class and become its class teacher (edit/delete still gated); `GET /schools/members` now returns each member's custom `roles`, rendered as badges on the staff cards; and the "Manage roles" dialog shows a tick on already-assigned roles and refreshes the cards on change.

## 2026-06-24

- [Subject scoping & ordering](./2026-06-24/subject-scoping-and-ordering.md) - the "Manage Grades" Subject dropdown was leaking every school's subjects (with duplicates) for admins and class teachers; `getMySubjectsForClass` now scopes by the class's school. Separately, the calculation engine now orders subjects by `sort_order` then `name`, matching the subject list and dropdown, so the report card and class report use one consistent order.
- [Theme-aware dropdowns & modal UX](./2026-06-24/theme-aware-dropdowns.md) - replaced native `<select>` elements (whose OS-drawn option popups were invisible on light-theme devices) with the theme-aware `Select` component across 18 files. Added "Select all" to the Enroll Students and student Subjects modals, capped the assigned-subjects list with a scroll, and sorted the enrolled students table by last name.
- [Foreign-key indexes](./2026-06-24/foreign-key-indexes.md) - new migration adding 16 indexes for the foreign keys flagged by Supabase's Performance Advisor that sit on query paths or back cascade deletes; pure audit-column FKs were intentionally skipped. A stray pre-existing index migration was made idempotent.
- [Docker image builds via turbo](./2026-06-24/docker-build-via-turbo.md) - the backend image now builds the whole monorepo with `turbo run build` and ships the backend with its non-hoisted `node_modules` (fixing a boot crash on missing `@nestjs/core`); added a root `.dockerignore`, modernized the Compose stack (fixed project name, redis service, healthchecks, service-name nginx upstreams), added `env.example`, and simplified the infrastructure CI to a build.

## 2026-06-04

- [Announcement board](./2026-06-04/announcement-board.md) - new school-wide notice board: `announcement` + `announcement_read` tables with RLS, an `announcement` RBAC resource, `AnnouncementModule` (CRUD + unread-count + mark-read), a `/dashboard/announcements` board with a permission-gated composer, a sidebar unread badge, and per-announcement read receipts (reader avatars with name tooltips). Content is cached per school; read receipts are merged in live.
- [Server-side report files](./2026-06-04/server-side-report-files.md) - moved all report-file generation (student/year/report-card/exam PDFs, class-summary PDF/CSV/XLSX) from the browser to the backend `ReportFilesModule`, which streams files to the client; added a bulk `class-zip` that streams a zip of every student's report card with flat memory; the frontend became a thin client and dropped `jspdf`/`xlsx`/`@react-pdf/renderer`/`jszip`.
- [Fixes & UI polish](./2026-06-04/fixes-and-ui.md) - `user_profile.email` column + backfill, null-gender crash fixes (dashboard chart + edit form), a persistent class sidebar across class sub-pages, and a redesigned role permissions editor (toggle-pill rows replacing the fragile checkbox matrix).
- [Dependency maintenance](./2026-06-04/dependency-maintenance.md) - replaced the unmaintained, advisory-carrying `xlsx` (SheetJS) with the actively maintained, write-only `write-excel-file` for XLSX report exports (the builders are now async); bumped `react-day-picker` 9 → 10 (`table` → `month_grid` classNames key); reconciled the root `react`/`react-dom` override that was silently pinning the repo to `19.2.5`, unifying all workspaces on `19.2.7`; evaluated `archiver` v8 and deliberately stayed on v7 (v8 is a typeless ESM-only rewrite).

## 2026-05-29

- [Security fixes](./2026-05-29/security-fixes.md) - authorization and input-validation batch from a follow-up audit: attendance IDOR (update / delete / roster), avatar object IDOR + content-type spoofing, deactivated-user access, admin self-elevation via onboard/join, per-student calculation/report IDOR, and a spoofable rate-limit identity. Backend-only, no migrations.

## 2026-05-25

- [Attendance tracking](./2026-05-25/attendance-tracking.md) - new `student.attendance_record` table + RLS, `AttendanceModule` with mark/bulk-mark/update/delete and per-student range + summary reports, mark-attendance page under `/dashboard/classes/[classId]/attendance` with a per-student report dialog.
- [Custom grade scales](./2026-05-25/custom-grade-scales.md) - new `grading.grade_scale` + `grade_scale_band` tables (one-default-per-school via partial unique index), `GradeScaleModule` CRUD with admin-only writes, convert-on-read in `GradeService` so each grade returns `converted: { label, gpaPoints, isPass } | null`, admin settings page at `/dashboard/grade-scales`, and a band badge next to scores in the grading table.
- [Auth + dev ergonomics](./2026-05-25/auth-and-dev-ergonomics.md) - incidental work that landed alongside the features: `useProfile` rebuilt as an `AuthProvider` Context so the whole app shares one `/auth/me` fetch, `SupabaseService.getUser` made non-throwing so stale refresh tokens don't crash `AuthGuard`, dev `start` scripts switched to Bun (the `'bun'` module crash), and dev-only throttle limits bumped (1000/min default, 100/hour auth-strict) so hot reloads don't trip 429s. Production limits unchanged.
- [Per-session throttling](./2026-05-25/per-session-throttling.md) - `default` throttler now keys off the session (Bearer token, then `sb-*-auth-token` cookie, then IP fallback) instead of the request IP, fixing 429s in production where every user behind a given Next.js middleware instance shared one IP-keyed bucket. Tokens are hashed before storage. Production `default` limit also bumped from 300 to 10,000 req/60s as a temporary safety margin while a suspected frontend request-loop is investigated.

## 2026-05-24

- [Critical security fixes](./2026-05-24/security-fixes.md) - five criticals from the repo audit: cross-school admin RLS bypass, `assignment_write` policy typo, IDOR in service-client endpoints, PDF upload arbitrary path, PDF download IDOR.
- [High-severity fixes](./2026-05-24/high-fixes.md) - follow-up batch: removed `schoolId` from profile-update DTO, school-scoped the `ClassTeacherGuard` admin bypass, added auth to `/calculations/student-*`, closed the first-admin race with a partial unique index, fixed avatar upload path injection, hardened nginx config.
- [Medium-severity fixes](./2026-05-24/medium-fixes.md) - third batch: per-email rate limit on OTP/account-delete, school-mismatch check on enrollment, search-input sanitization in student.service, `leaveSchool` clears stale join requests, removed unused `@supabase/supabase-js` from frontend, added CSP header to nginx.
- [Low-severity fixes](./2026-05-24/low-fixes.md) - final cleanup: `BulkGradeDto` payload bounds, removed `X-Server-Port` debug header, fixed `docker-compose.yml` nginx mount path, registered `@fastify/cookie` in the Cloudflare worker entrypoint, removed OTP-paste auto-submit, fixed double-decode on onboard/pending page.
- [Redis resilience against Upstash idle disconnects](./2026-05-24/redis-resilience.md) - `CacheService` swallows Redis errors and degrades gracefully; `RedisStore` keeps the connection alive with a 60s `PING`.
- [Infrastructure CI: Dockerfile & build workflow](./2026-05-24/infrastructure-ci.md) - added a multi-stage Bun Dockerfile for the backend, fixed the compose build context, and replaced the validation-only CI with three jobs (nginx syntax, `docker compose build`, mock-upstream reverse-proxy test) wired up through small scripts in `.github/scripts/`.
