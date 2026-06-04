---
sidebar_label: 2026-06-04 · Fixes & UI
sidebar_position: 4
---

# 2026-06-04 - Fixes & UI polish

Smaller changes that landed alongside the announcement board and the report-file migration.

## `user_profile.email` column + backfill

Added an `email` column to `user_profile` ([20260602220815_added_email_column_to_user_profile.sql](../../../../supabase/migrations/20260602220815_added_email_column_to_user_profile.sql)) and populated it from the auth user:

- **New users** - the profile insert on first OTP verification sets `email`.
- **Existing users** - backfilled lazily in `verifyOtp` (from the session) and in `getProfile` (via `auth.admin.getUserById`), so a profile fills in on the user's next login or profile fetch ([auth.service.ts](../../../../backend/src/auth/auth.service.ts)).

## Null-gender crashes

`SchoolStudent.gender` / `Student.gender` were typed `"male" | "female"`, but the column is nullable. A student with no gender crashed the admin dashboard (`STUDENT_CONFIG[null].label`) and the edit form (`<select value={null}>`).

**Fix.** Types corrected to `… | null`; the dashboard chart only tallies known genders, and the edit form falls back to an empty-string placeholder ([AdminDashboard.tsx](../../../../frontend/app/dashboard/_components/AdminDashboard.tsx), [EditStudentForm.tsx](../../../../frontend/app/dashboard/students/_components/EditStudentForm.tsx)).

## Persistent class sidebar

The class detail page's horizontal button row (Grading, Attendance, Reports, Class Report, Enroll) became a **persistent sidebar** via a shared layout at [classes/[classId]/layout.tsx](../../../../frontend/app/dashboard/classes/[classId]/layout.tsx) - vertical nav on desktop, horizontal scroll on mobile - that stays visible and highlights the active page across all class sub-routes. "Enroll Students" deep-links to the overview with `?enroll=1`, which opens the (now controlled) enroll dialog.

## Permissions editor redesign

The role permissions dialog ([PermissionsEditor.tsx](../../../../frontend/app/dashboard/roles/_components/PermissionsEditor.tsx)) was rebuilt. The old CSS-grid checkbox matrix had recurring alignment/overlap issues (mismatched sticky-header background, footer overlapping rows on short viewports, header/row column drift). It's now a flat list of resources, each row showing **View / Create / Edit / Delete toggle pills** (filled = granted) - self-contained per row, so there are no columns to misalign. The dialog is bounded to `max-h-[85vh]` with a fixed header/footer and a scrolling body.
