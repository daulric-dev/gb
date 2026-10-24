---
sidebar_label: 2026-10-23 · Course copy and templates
sidebar_position: 4
---

# 2026-10-23 - Course copy and templates

Teachers can start a course from an existing one, and schools can keep template courses.

## What it does

- **Copy course** (course Settings) makes a new **draft** course from an existing one, with a name, code, year and term chosen in the dialog. Due dates can be kept, moved by N days, moved by the gap between the old and new start dates, or cleared.
- The copy takes the description, grade scale, assignment groups (weights, drop lowest/highest), rubrics with criteria and levels, pages, modules and items, activities with quiz questions and options and their rubric, and staff-written discussion topics. Every link is repointed at the copy: module items point at the copied pages and activities, activities at the copied groups and rubrics, and course/page/activity ids inside page and instruction text are rewritten. File items keep the same file.
- Activities are copied as **drafts** and discussion topics **unpublished**; pages, modules and items keep their published flag (the new course is a draft, so nothing is visible until it is published).
- Not copied: students, enrolments, submissions, marks, rubric assessments, attendance, announcements, notifications, discussion replies and read markers, topics started by students, file shares, the join code. The copier becomes the new course's only teacher. One transaction - a failed copy leaves nothing behind.
- **Templates**: a teacher or admin flags a course as a **School template** in Settings. Templates are listed under **New course → Start from a template** for everyone with `course:create` in the school, who can copy one without a role in it. Templates take no students: join codes can't be issued and are refused, enrolment is refused, the portal never lists them, and a course with students can't become one (409).
- **Import** (API only for now): `POST /courses/:courseId/import` appends another course's content to an existing course; assignment groups with the same name are merged, modules land after the course's own.

## Deploying

Migration `20261023150000_course_templates` adds `course.course.is_template` (boolean, default false) and a partial index on `school_id` for templates. Apply with `bun run db:deploy`.

## API

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/courses/templates` | `course:create`; the school's templates with module/activity/page counts |
| `POST` | `/courses/:courseId/copy` | `course:create` + manage role in the source, or the source is a school template. Body: `name`, `code?`, `academicYearId?`, `termId?`, and at most one of `shiftDays`, `sourceStartDate`+`targetStartDate`, `clearDueDates`. Returns the new course plus `copied` counts |
| `POST` | `/courses/:courseId/import` | Manage role in the target; body `sourceCourseId` plus the same date fields |
| `PATCH` | `/courses/:courseId` | Accepts `isTemplate` |

Course responses gain `isTemplate`. See [Course copy and templates](../../backend/course-copy.md).

`bun run smoke` copies Biology 101 with a 7-day shift, compares content counts, checks items point at the copied draft activities, flags the copy as a template, creates a course from it as another teacher, checks joins and enrolments are refused, and deletes what it made.

## Not yet

A web screen for import, copying course file shares, and choosing which parts of a course to copy.
