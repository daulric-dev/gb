---
sidebar_label: 2026-09-20 · Student profiles and teacher access
sidebar_position: 6
---

# 2026-09-20 - Student profiles, subject-teacher access, cache fixes

## Student profile page

Selecting a student - from the students list or a class roster - opens `/dashboard/students/<id>`, showing details, the classes they are in (this year first, past years below, each linking through), the subjects they take this year, their linked login, and any guardians.

`GET /students/:id/profile` is a **new** endpoint rather than a widening of `GET /students/:id`, because that response goes through the versioned `student.detail` transformer and mobile reads it - changing its shape would have been a breaking change for no reason.

It is assembled in JS, not by embedding: the pieces sit in three schemas and **PostgREST will not follow a foreign key across a schema boundary**.

## Subject teachers can reach their classes

A teacher assigned to a *subject* in a class, but never added as a group teacher, **could not see the class at all** - so they could not reach it to set work, however many subjects they taught there.

`getMyClasses` listed classes only from `staff.teacher_group_assignment`. It now merges that with `staff.teacher_subject_assignment`, with the group assignment winning where both exist, since only it carries the `is_class_teacher` flag the rest of the app keys off.

This was never a permissions problem: teachers already hold every `assessment` and `grade` key. It was pure visibility.

### Report access, reads only

`ClassTeacherGuard` required `is_class_teacher`. It gained a `ClassMemberGuard` subclass that also accepts a subject assignment, applied **by HTTP verb**:

- **Open to subject teachers (16 GETs)** - class summary, analytics, summary download and files, the report list, a student's report, report detail, PDF history, latest PDF, PDF download, and the report-files PDFs (student term, student year, report card, exam report, class summary, class zip).
- **Still class-teacher only (8 writes)** - generate, edit, regenerate, publish, send-to-ministry, PDF save, PDF upload, class-summary persist.

Enrolment, attendance and class endpoints keep the strict guard: changing a roster is not a read.

## Cache key bugs

Two of the same shape, both causing "I made a change and the app didn't notice".

**`my-subjects`** was keyed `my-subjects:<classId>` - **not by user** - while the two invalidation sites deleted `my-subjects:<teacherId>:<classId>`, a key nothing ever wrote. So it never self-corrected, *and* one teacher's subject list could be served to another teacher for the same class. Now keyed by user and class, with matching invalidation. Creating, renaming or deleting a subject also clears the family, which it never did - the visible symptom being a subject dropdown that stayed empty for 30 days after the subject was created.

**`my-classes`** is cached both bare and per academic year, but `addTeacher`/`removeTeacher` deleted only the bare key. A newly assigned teacher kept seeing the old list until the TTL expired. Both shapes now clear by prefix.

## Known gap

> **Fixed** on 2026-09-21 - see [Backlog cleanup](../2026-09-21/backlog-cleanup.md). The sweep that followed found this was one of **eight** foreign keys with no delete rule, two of which broke school deletion outright.

`student.student_subject_profile.academic_year_id` has **no `ON DELETE CASCADE`**, so deleting an academic year fails while any subject profile references it. The earlier cascade migrations covered enrolments and assessments but missed this table.
