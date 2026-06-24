---
sidebar_label: 2026-06-24 · Foreign-key indexes
sidebar_position: 3
---

# 2026-06-24 - Foreign-key indexes

Indexed the foreign keys flagged by Supabase's Performance Advisor. One new migration; additive only.

## What and why

The Performance Advisor's "unindexed foreign keys" lint flagged 27 foreign keys with no covering index whose leading column is the FK column. Without one, lookups and joins on the FK, and the parent-side `ON DELETE` cascade / set-null scans, fall back to sequential scans.

[20260623120000_index_foreign_keys.sql](../../../../supabase/migrations/20260623120000_index_foreign_keys.sql) adds 16 indexes, covering the foreign keys that sit on real query paths or back cascade deletes:

- `grading`: `grade.student_id`, `assessment.subject_id`
- `reporting`: `report_book.student_group_id`, `report_book.term_id`, `report_book_entry.subject_id`, `report_book_pdf.report_book_id`
- `staff`: `teacher_group_assignment.student_group_id`, `teacher_subject_assignment.student_group_id`, `teacher_subject_assignment.subject_id`
- `student`: `student_subject_profile.student_id`, `student_subject_profile.subject_id`, `parent_student_link.user_profile_id`
- `public`: `school_join_request.school_id`, `school_management_role.school_role_id`, `school_role_permission.permission_id`, `announcement.author_user_profile_id`

The remaining 11 flagged foreign keys are pure audit columns (`created_by`, `updated_by`, `reviewed_by`, `generated_by`, and similar) that the app never filters on. Indexing them only adds write overhead, so they were intentionally skipped. Their sole benefit would be speeding the rare user-deletion scan.

All index creations use `CREATE INDEX IF NOT EXISTS`, so the migration is safe to re-run.

## Related

A separate, pre-existing index migration ([20260624023717_added_indexes_to_stuff.sql](../../../../supabase/migrations/20260624023717_added_indexes_to_stuff.sql), which adds `school_management_user_id_idx`) was made idempotent with `IF NOT EXISTS` so `supabase migration up` stops erroring on an already-present index.

## Deploy

Run the migrations. On a database with existing data and traffic, prefer creating these indexes with `CONCURRENTLY` outside a transaction; the tables here are small, so the plain `CREATE INDEX` in the migration is fine for current scale.
