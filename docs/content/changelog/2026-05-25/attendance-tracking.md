---
sidebar_label: 2026-05-25 · Attendance tracking
sidebar_position: 1
---

# 2026-05-25 - Attendance tracking

## Summary

New feature: schools can now record daily attendance per student per class and view per-student attendance reports over arbitrary date ranges. Status values are `present`, `absent`, and `late`.

## Schema

Migration `20260525120000_attendance.sql`:

- `public.attendance_status` enum (`present` | `absent` | `late`).
- `student.attendance_record` table with one row per (student, class, date), enforced by a unique constraint on `(student_id, student_group_id, attendance_date)`. Re-marking a student on the same date upserts.
- Indexes: `(student_group_id, attendance_date)` for the class roster on a date, and `(student_id, attendance_date)` for per-student history.
- RLS: 4 policies (read, insert, update, delete) all match the existing pattern - admins see/write rows whose class rolls up to their school, teachers see/write only rows for groups they're assigned to via `is_assigned_to_group()`.

## Backend

New `AttendanceModule` mounted at `/classes/:classId/attendance`:

- `GET ?date=YYYY-MM-DD` - class roster on a date, each enrolled student paired with their mark (or `null` if unrecorded).
- `POST` and `POST /bulk` - mark one or many students for a date (upsert).
- `PATCH /:recordId` and `DELETE /:recordId` - amend or remove a single record.
- `GET /students/:studentId?from=&to=` - all records for a student in the class over the date range.
- `GET /students/:studentId/summary?from=&to=` - counts per status plus an `attended %` (counting late as attended).

Writes are gated by `ClassTeacherGuard` (admin-in-school or class teacher). Reads use a service-level `assertCanViewClass` that admits admins-in-school and any teacher assigned to the group.

The roster query is cached for 5 minutes at `attendance:roster:<classId>:<date>` and invalidated on every write to that key.

## Frontend

- New page at `/dashboard/classes/[classId]/attendance` - date picker, roster with a three-button toggle (present/absent/late) per student, "mark all present" shortcut, and a Save button that issues one bulk upsert.
- Per-student attendance report dialog reachable from each roster row, with from/to date inputs, summary tiles (counts + attended %), and a scrollable list of marks.
- "Attendance" button added to the class detail page next to "Grading".

Status colors use emerald/amber/rose for present/late/absent.

## Notes

- The `attendance_status` enum intentionally omits `excused` - the spec only listed three statuses. Adding it later is a one-line `ALTER TYPE ... ADD VALUE`.
- Reports are deliberately scoped to a single student (no per-class aggregate summary). Per-class breakdowns can be added later without schema changes.
- `database.types.ts` was not regenerated for this migration. The new module defines its row types locally; other code paths are unaffected. Run `supabase gen types` if you want the global typings to reflect the new table.
