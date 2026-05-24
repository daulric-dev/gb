---
sidebar_label: 2026-05-24 · Security fixes
sidebar_position: 2
---

# 2026-05-24 - Critical security fixes

Audit of the repo surfaced five critical issues, all fixed in this release. Apply the new migrations against Supabase **before** deploying the backend.

## Cross-school admin RLS bypass

`public.is_admin()` checked role only, not school. Every `assignment_read` / `assignment_update` / `assignment_write` / `assignment_isolation` policy on `grading.*`, `reporting.*`, and `student.*` used it as a permissive bypass - so a user with `role='admin'` in school A could read and mutate rows in school B via direct Supabase queries. The companion `school_isolation` policies didn't help because they're permissive too (combined with OR, not AND).

**Fix.** New migration `supabase/migrations/20260524180100_school_aware_admin_policies.sql` rewrites every affected policy to require `is_admin() AND <row's school> = get_user_school_id()`. For tables without a direct `school_id` column, the school is resolved via the appropriate join (`assessment → subject`, `grade → assessment → subject`, `report_book → academic_year`, etc.). The same migration pins `search_path` on `is_admin`, `get_user_school_id`, `is_assigned_to_group`, and `is_assigned_to_subject_in_group` (defense-in-depth against search-path hijack on `SECURITY DEFINER` functions).

**Behavior change.** Admins can no longer see or edit data in other schools through direct Supabase queries. If any tooling in your fleet was relying on this, it will now break.

## `assignment_write` policy self-comparison typo

The `WHERE` clause on `grading.assessment`'s INSERT policy contained `tsa.subject_id = tsa.subject_id` instead of `tsa.subject_id = assessment.subject_id`. Any teacher with any subject assignment in a term could INSERT assessments for any subject in that term.

**Fix.** New migration `supabase/migrations/20260524180000_fix_assignment_write_assessment.sql` drops and recreates the policy with the correct comparison.

## IDOR in service-client endpoints

`student.findOne/update`, `subject.findOne/update/delete/reorder`, `term.findOne/update/delete/findByYear`, and `academic-year.findOne/update/setActive/deactivate` used the service client and keyed off the row id only. Any authenticated user could read or mutate rows in other schools by iterating ids.

**Fix.**

- Added [`SupabaseService.getUserSchoolId(userId)`](../../../../backend/src/supabase/supabase.service.ts) as a single source of truth for resolving the caller's school.
- Every affected service method now adds `.eq('school_id', schoolId)` (or, for `term`, joins through `academic_year` since term has no direct `school_id`).
- Cache invalidation in `subject.delete` / `subject.reorder` is now scoped to the caller's school instead of using `deleteByPrefix('subjects:')` - the old behavior was purging other schools' caches unnecessarily.
- Controllers now plumb `req.user.id` through to the service.

## PDF upload arbitrary storage path

`POST /reports/:id/pdf` accepted an `objectPath` multipart field from the client and wrote it to the `report-books` bucket with `upsert: true`. Any class teacher could overwrite any other school's PDFs.

**Fix.** [report.controller.ts](../../../../backend/src/reporting/report.controller.ts) and [report.service.ts](../../../../backend/src/reporting/report.service.ts) no longer accept `objectPath` from the client. The storage path is derived server-side as `${reportId}/${timestamp}-${crypto.randomUUID()}.pdf`, and `upsert` is now `false` so collisions fail instead of overwriting.

**No backfill needed.** Existing PDFs at flat paths (`<reportId>.pdf`) are still downloadable because `downloadPdf` reads `file_path` from the DB row.

## PDF download IDOR

`GET /reports/:id/pdf/:pdfId/download` used the service client and never verified `pdfRow.report_book_id === :id`. The `ClassTeacherGuard` authorized against `:id` (the report id in the URL), but `pdfId` could point to any PDF in any school.

**Fix.** [report.service.ts](../../../../backend/src/reporting/report.service.ts) `downloadPdf` now takes both `reportId` and `pdfId`, fetches `report_book_id` alongside `file_path`, and throws `NotFoundException` if they don't match.

## Tests

- [test/mocks.ts](../../../../backend/src/test/mocks.ts): mock `SupabaseService` now exposes `getUserSchoolId` so service unit tests can construct it without manually stubbing.
- Student / subject / term / academic-year test files updated to pass `userId` and to assert *scoped* cache invalidation. Some existing tests were asserting cross-school cache deletion as the correct behavior - that was wrong and is now corrected.
- Full suite: 101 passing.

## Deploy order

1. Apply both new migrations to Supabase (order between them doesn't matter - they touch disjoint policies).
2. Deploy the backend.

## Still open from the same audit

These were rated High or below and are not yet fixed:

- `PATCH /auth/profile` accepts `schoolId` in the DTO and writes it raw without a membership check ([update-profile.dto.ts](../../../../backend/src/auth/dto/update-profile.dto.ts), [auth.service.ts](../../../../backend/src/auth/auth.service.ts)).
- First-admin race in `onboard` and `school.createJoinRequest` - non-transactional check-then-insert can produce two admins. Needs a unique partial index `(school_id) WHERE role='admin'`.
- `ClassTeacherGuard` short-circuits on platform-`admin` role without checking the class's school ([class-teacher.guard.ts](../../../../backend/src/class/class-teacher.guard.ts)).
- `/calculations/student-term` and `/calculations/student-year` accept `studentId` with no authorization check at all ([calculation.controller.ts](../../../../backend/src/calculation/calculation.controller.ts)).
- nginx config: no TLS, `X-Real-IP $host` (should be `$remote_addr`), no security headers, no `client_max_body_size`.
- Avatar upload path injection via `Query('pathname')` ([auth.controller.ts](../../../../backend/src/auth/auth.controller.ts)).
- UPDATE RLS policies on grading tables lack `WITH CHECK` (this batch added `WITH CHECK` to the policies it rewrote, but a full audit of other UPDATE policies is still pending).
