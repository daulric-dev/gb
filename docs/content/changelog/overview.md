---
sidebar_label: Overview
sidebar_position: 1
---

# Changelog

Notable changes to the codebase, grouped by date.

Each entry below links to a dedicated page with the full writeup - what changed, why, what to deploy, and any behavior changes downstream consumers should know about.

## 2026-09-20

- [Grading schemes belong to a class](./2026-09-20/class-grading-schemes.md) - a weighted scheme is configured per class and every subject that class takes follows it, replacing the school-wide `(term, subject)` scope. Editing an inherited scheme now forks it to the class instead of silently changing the school default, and a trigger seeds Coursework/Exam for every new term (previously any term created after the original seed resolved to nothing and opened blank).
- [Quiz authoring, question types and attempts](./2026-09-20/quiz-authoring-and-attempts.md) - questions are editable in place; `short_answer` joins multiple choice and true/false (auto-marked, case- and space-insensitive, with its accepted wordings withheld from the student); `max_attempts` allows retakes with the limit enforced under the row lock. Questions now **lock at publish** - previously the API allowed edits that would silently rescore work already handed in. Title, description, due date and points became editable, which exposed a rename never reaching the gradebook.
- [File uploads moved to TUS](./2026-09-20/resumable-uploads.md) - uploads go straight from the client to Storage and resume after a dropped connection; the scan moved after the bytes land, with the file quarantined as `pending` until it passes. Signed upload tokens are refused by the resumable endpoint, so the backend mints a short-lived session JWT confined by storage RLS. Also fixed: handing in text would silently detach a file uploaded moments earlier.
- [Manual assessment authoring retired](./2026-09-20/retire-manual-assessments.md) - the web and mobile Grading screens and the `/assessments` write endpoints are gone; assessments only come from publishing Work. A **Do not count** toggle preserves the one capability with no substitute; per-assessment weight was deliberately dropped in favour of grading groups.
- [Reporting and calculation fixes](./2026-09-20/reporting-and-calculation-fixes.md) - grades never reached the class summary because subjects came only from the hand-maintained subject profile (a mark is now evidence too); every edge-function feature was down because `SUPABASE_SERVICE_ROLE_KEY` held the internal secret rather than the service-role JWT; and `getClassSummary`'s in-process fallback could never run **and** disagreed with the edge path when it did.
- [Student profiles and teacher access](./2026-09-20/students-and-access.md) - a student profile page showing classes, subjects, account and guardians; subject teachers can now see and set work in their classes (they were invisible entirely) and read that class's reports, while writes stay with the class teacher; plus two cache-key bugs, one of which could serve one teacher's subject list to another.
- [Mobile: student parity, connectivity, claymorphism](./2026-09-20/mobile-student-app.md) - Work and report detail bring students to parity with web; three separate reasons the app could not reach the API (including an IP that changed mid-session) fixed at the root by deriving the host from the Expo dev server; a claymorphic theme over the web palette; and pull-to-refresh plus four-edge safe areas.
- [OTP screen redesign](./2026-09-20/otp-verification-redesign.md) - bigger boxes, auto-focus, auto-submit on the last digit, errors shown in place with the code cleared, and one clear action instead of three stacked buttons. Fixed the code row overflowing its card on both web and mobile.

## 2026-09-17

- [Student accounts](./2026-09-17/student-accounts.md) - students hold their own login, join a school with a school-wide code, and get a self-scoped `/portal/me` API; `account_type` splits which application someone belongs to from what they may do in it. Students hold **no catalog permissions**. Closed a privilege escalation any authenticated user could perform (`UPDATE user_profile SET role='admin'`), and fixed per-route throttles sharing one bucket.
- [Weighted grading groups](./2026-09-17/weighted-grading-groups.md) - term grading moved from two fixed buckets to N named groups whose weights sum to 100, seeded from the existing weights so results are unchanged. Groups with no marks are dropped and the remainder renormalised; `is_exam` marks the group that feeds the year-end exam block.
- [Quizzes and assignments](./2026-09-17/quizzes-and-assignments.md) - teachers set work, students complete it in their portal, and quizzes are marked and written to the gradebook in one transaction. Correct answers are never sent to students. Also completed the school-deletion cascade, including a trigger that was blocking its own database.

## 2026-07-12

- [Scan all storage uploads](./2026-07-12/scan-all-storage-uploads.md) - virus scanning moved to the storage boundary, so every file written to a bucket is scanned, not just file-manager uploads. `ClamavScanner` moved to a global `ScanModule`; `SupabaseService.uploadFile`/`scanOrThrow` scan before storing (fail-closed); report writers and the resumable-avatar completion step scan too (the TUS path downloads + deletes + rejects if infected). The file manager's async `file-scan` queue was removed - uploads scan synchronously and record `ready` directly.

## 2026-07-11

- [File manager hardening](./2026-07-11/file-manager-hardening.md) - the file manager went production-ready: real ClamAV virus scanning (INSTREAM over TCP, fail-closed, passthrough when unconfigured), magic-byte content-type verification on upload (the client MIME type is no longer trusted alone), and real in-app share notifications (new `file_manager.notification` table + `/files/notifications` endpoints + a Files sidebar unread badge). Also fixed an N+1 in `GET /files` (principals resolved once, download flags batched) and added optional pagination, plus tests for the previously-untested access logic (212 → 234).

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
