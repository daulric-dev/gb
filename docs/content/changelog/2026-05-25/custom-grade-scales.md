---
sidebar_label: 2026-05-25 · Custom grade scales
sidebar_position: 2
---

# 2026-05-25 - Custom grade scales

## Summary

New feature: school admins can configure how numeric grades are displayed - as letter grades (A-F), GPA points, or pass/fail bands. One scale per school is marked as the default; without a default, grades show as numeric scores (unchanged behavior).

Conversion happens at read time. The `grades` table still stores the numeric `score` as the source of truth; the active scale is looked up and applied to map score+max_score to a band on the way out.

## Schema

Migration `20260525130000_grade_scales.sql`:

- `public.grade_scale_type` enum (`letter` | `gpa` | `pass_fail`). Numeric display = no active scale.
- `grading.grade_scale` - one row per scale a school defines. Columns: `school_id`, `name`, `scale_type`, `is_default`, audit fields. A partial unique index `(school_id) WHERE is_default = true` enforces at most one default per school.
- `grading.grade_scale_band` - the bands within a scale. Columns: `label`, `min_percentage`, `max_percentage` (both `numeric(5,2)`, CHECK-constrained to `0 <= min <= max <= 100`), nullable `gpa_points` (`numeric(4,2)`, only meaningful for GPA scales), `is_pass` boolean, `sort_order`. Unique on `(grade_scale_id, label)`.
- RLS: scales and bands are readable by any user in the same school (teachers need to read them to render converted grades). Writes (`INSERT`/`UPDATE`/`DELETE`) are admin-only and school-scoped.

Bands may not overlap. Gaps are intentionally allowed - a school can leave 0-39% unscored and the convert-on-read layer returns `null` for scores in the gap. Overlap validation is enforced in the backend service rather than the DB (clearer error messages).

## Backend

New `GradeScaleModule` mounted at `/grade-scales`:

- `GET /grade-scales` - list (default first, then alphabetical).
- `GET /grade-scales/default` - the active default with bands (cached at `grade-scale:default:<schoolId>` for 24h).
- `GET /grade-scales/:id` - one scale with bands.
- `POST /grade-scales` - create scale + bands in one call. If `isDefault: true`, atomically demotes the existing default first.
- `PATCH /grade-scales/:id` - update name and/or default flag.
- `PUT /grade-scales/:id/bands` - replace the whole band set.
- `POST /grade-scales/:id/set-default` - promote a scale to default (demotes any current default).
- `DELETE /grade-scales/:id` - cascades to bands.

Writes are gated by `AdminGuard`. Reads are open to any authenticated user; cross-school isolation is enforced via `resolveSchoolId(userId)` and a 404 on any out-of-school lookup.

Convert-on-read is wired into `GradeService`:

- `findByAssessment` and `findByTermAndSubject` each fetch the school's default scale once per request via `gradeScale.getDefault(userId)` (cached).
- Each grade in the response now carries `converted: { label, gpaPoints, isPass } | null`. `null` means either no default scale, no `max_score`, or the score fell in a gap between bands.

## Frontend

- New admin-only page at `/dashboard/grade-scales` - list of scales with set-default / edit / delete actions, plus a "New scale" dialog. The bands editor seeds reasonable defaults per scale type (GPA seeds A=4.0..F=0.0, pass/fail seeds Pass>=50, letter seeds A=90..F&lt;60) so admins don't start from a blank slate.
- Scale type is locked after creation (UI dims the select with an explanatory note).
- Bands editor enforces overlap validation client-side before submitting.
- Added an "Admin" group to the sidebar (only rendered when `profile?.role === "admin"`) with the Grade Scales entry.
- Grade entry tables (`/dashboard/classes/[classId]/grading`) now show a small color-coded badge next to each score (`B+`, "Pass", etc.). The badge variant is `default` (green) for pass bands, `destructive` (red) for fail bands; GPA points appear as a tooltip when set. With no default scale or a score in a gap, no badge renders - the numeric score stands alone, unchanged from before.

## Notes

- Calculation views (term/year averages on `/dashboard/classes/[classId]`) do not currently apply scale conversion. Averages are computed without a single source `max_score`, so converting them is a separate design decision (convert each grade then average vs. average then convert) - punted until needed.
- "Set default" is implemented as a sequential demote-then-promote, not a transaction. If two admins click simultaneously, the partial unique index returns `23505` and the loser gets a 409. Acceptable for v1.
- The `convertScore` helper on `GradeScaleService` is pure (no I/O); export it from other modules if you ever need scale conversion outside the grade read path.
