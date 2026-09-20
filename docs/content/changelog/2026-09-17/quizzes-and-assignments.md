---
sidebar_label: 2026-09-17 · Quizzes and assignments
sidebar_position: 3
---

# 2026-09-17 - Quizzes and assignments

Teachers can set quizzes and assignments; students see them in their portal and complete them there. Quizzes are marked the moment they are handed in, and the mark flows straight into the gradebook.

Migrations: `20260917190000_activities`, plus `20260917210000_cascade_school_deletion` and `20260917230000_cascade_staff_and_activity`.

## The model

`grading.activity` is a piece of work set for **one class, one subject, one term** (`student_group_id` is what targets it at a class). It carries `kind` (`quiz` | `assignment`), points, an optional due date, a status (`draft` → `published` → `closed`), and for assignments the hand-in options `allow_file` / `allow_text`.

Supporting tables: `quiz_question`, `quiz_option`, `submission`, `quiz_answer`.

An activity is a **draft until published**. Publishing is what creates the `grading.assessment` row, which is what the calculation engine and reports read. Before that, nothing exists in the gradebook.

## Automatic marking

`submit_quiz` is a `SECURITY DEFINER` RPC that scores the submission, scales the raw score to the activity's points, writes `grading.grade`, and marks the submission graded - **in one transaction**. A partial score never coexists with an ungraded submission.

The student id it scores for is passed in from the guard, never from the request body.

## What students see

`/portal/me/activities` lists work set for the classes they are enrolled in, and the detail endpoint returns the questions. **Correct answers are never selected** for the student payload - the answer key is one devtools tab from being read, so it is not sent at all.

## What teachers see

The class gains a **Work** section: create quizzes and assignments, add questions, publish, close, and a submissions tab listing every enrolled student with their submission or lack of one. Assignment marks are entered per row and write through to the gradebook on the same path quiz auto-marking uses.

## Deletion cascades

Deleting a school failed outright, because structure it owned had no cascade. Two migrations added `ON DELETE CASCADE` across academic years, terms, classes, subjects, students, enrolments, assessments, grades, report books, the staff schema's teaching assignments, and activities.

Authorship is treated differently from structure: `activity.created_by`, `submission.graded_by` and `school_join_code.created_by` are `ON DELETE SET NULL`, because a teacher who once set work should be removable without deleting the work.

### The trigger that blocked its own database

`guard_user_profile_privileges` - added the same day to stop privilege escalation - refused the cascade. Deleting a school nulls `user_profile.school_id` through the foreign key, and that happens with no authenticated user, so `auth.role()` was not `service_role` and the trigger rejected it.

`20260917220000_privilege_guard_system_contexts` exempts `auth.uid() IS NULL` as well. That is safe because reaching the row at all is RLS's job, and its policies require `id = auth.uid()` or `is_staff()` - a caller with no `auth.uid()` passes neither.

## PostgREST note for future work

`grading.assessment → public.subject` embedding fails with "could not find a relationship" despite the foreign key existing: **PostgREST will not follow a foreign key across a schema boundary.** Lookups that cross schemas are fetched separately and joined in JS. This bit the activities work and again later, and is worth knowing before writing a `select` with an embed in this codebase.
