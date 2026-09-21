---
sidebar_label: 2026-09-20 · Reporting and calculation fixes
sidebar_position: 5
---

# 2026-09-20 - Reporting and calculation fixes

Three separate faults, all presenting as "the numbers are missing".

## Grades never reached the class summary

A student sat a quiz, it auto-marked, `grading.grade` held the score - and the Class Summary still said **"No grades recorded for this term yet."**

The calculation derived each student's subjects **solely from `student.student_subject_profile`**, the hand-maintained record of what a student is *meant* to take. Nothing forces that table to be filled in, so a student with real marks and no subject profile was concluded to take no subjects.

A student's subjects are now the **union** of the profile and the subjects they have actually been marked in. A recorded mark is evidence they take the subject. The old rule meant a real grade could vanish from a summary *and from the report book* because nobody ticked a box.

Applied to all three paths - single-student term, class term, class year. The year path needed no extra query; it already had the assessments and grades in hand.

Pinned by [class-summary.test.ts](../../../../backend/src/calculation/class-summary.test.ts): a graded subject appears with no profile, and a profiled subject is not listed twice when both sources agree.

## Every edge-function feature was down

`backend/.env` had `SUPABASE_SERVICE_ROLE_KEY` set to the edge runtime's **internal secret** (`sb_secret_…`), not the service-role JWT.

PostgREST accepts that format, so every database call worked and nothing looked wrong. The edge function gateway requires a JWT and rejected it with `UNAUTHORIZED_INVALID_JWT_FORMAT`, taking out **every edge-backed feature at once**:

| Feature | Edge function |
| --- | --- |
| Class Report summary | `report-class-summary` |
| Grade analytics | `grade-analytics` |
| Dashboard | `dashboard-summary` |
| Attendance summary | `attendance-summary` |
| File ingest, share notifications | `file-ingest`, `file-share-notify` |

Worth checking on any environment showing the same symptom: the value must be the project's service-role **JWT**.

## The fallback that could never run

`getClassSummary` computes the summary in process when the edge function is unavailable - but it **threw on edge error instead of falling through**, so the fallback was dead code. One misconfigured key took the whole page down while a working implementation sat unused underneath.

It now logs a warning and computes in process.

The fallback was also **wrong**. It built a *user* client from the request while the edge path runs as service role (the backend invokes it with the service key), so the two disagreed - with the edge function stubbed out it returned 0 students against the edge's 1. Both now answer as service role, with the controller's permission and class-teacher guards deciding who may ask. Verified: with the edge function simulated as down, the fallback returns an identical result.
