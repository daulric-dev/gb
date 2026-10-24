---
sidebar_label: Course copy and templates
---

# Course Copy and Templates

**Location**: `backend/src/course/course-copy.service.ts`, `course-copy.controller.ts`, `dto/course-copy.dto.ts`

Copying a course's design into a new draft course, importing it into an existing course, and school templates.

## Routes

| Method | Path | Gate | Purpose |
|--------|------|------|---------|
| `GET` | `/courses/templates` | `course:create` | The caller's school's templates, with `moduleCount`, `activityCount`, `pageCount` |
| `POST` | `/courses/:courseId/copy` | `course:create` + source readable | New draft course from the source; returns the course (`role: 'teacher'`, `studentCount: 0`) and `copied` counts |
| `POST` | `/courses/:courseId/import` | manage role in `:courseId` + source readable | Append the source's content; returns `copied` counts |
| `PATCH` | `/courses/:courseId` | manage role | `isTemplate: true/false` (in `CourseService.update`) |

**Readable source** (`requireSource`): the caller is admin or teacher in it, or it is a template in a school where the caller is a member holding `course:create`. A TA gets 403, anyone else 404.

**Dates** (`CopyDatesDto`, at most one, else 400): `shiftDays` (integer, ±3660), `sourceStartDate` + `targetStartDate` (`YYYY-MM-DD`; shift = whole days between them), or `clearDueDates`. None keeps dates. Only `activity.due_at` carries a date today.

## What is copied

`copyContent(tx, sourceId, targetId, userId, shift)` reads the source and writes everything with ids minted in the service, so pointers are repointed before any insert and each table is one `createMany`, parents first:

| Source | Copy |
|--------|------|
| `assignment_group` | name, weight, position, drop rules. On import, a group whose name matches one in the target (case-insensitive, matching the unique index) is reused |
| `rubric`, `rubric_criterion`, `rubric_rating` | everything; `created_by` = copier |
| `activity` | every field, `status = 'draft'`, `published_at = null`, `due_at` shifted/cleared, group and rubric repointed |
| `quiz_question`, `quiz_option` | everything |
| `page` | title, body, `is_published` kept |
| `module` | title, position (offset after the target's own on import), `is_published` kept |
| `module_item` | repointed to copied module/page/activity/discussion topic; `file_id` and `url` unchanged. A discussion item pointing at a student-started topic (not copied) is dropped |
| `discussion_topic` | staff-authored only, with a minted id so discussion items follow it; `is_published = false`, author = copier, no replies or reads |
| `discussion_setting` | on copy (not import) |

Course, page, activity and group ids appearing in page bodies, activity instructions and topic bodies are rewritten to the copy's ids (`relinkIds`), so in-course links stay in the copy.

Never copied: `course_student`, `course_staff` (the copier is the only teacher), submissions, rubric assessments, attendance, announcements, course notifications, discussion replies/reads, file shares, `join_code` (null, as on create).

Copy runs in one interactive transaction (60s timeout): the course row, the copier's `course_staff` row, the setting and all content commit together or not at all.

**File items** keep the source's file id rather than requiring the copier to own the file (as `ModuleService.resolveTarget` does for new items): the source course already offered it. `GET /portal/me/courses/:courseId/files/:fileId` authorises by a published module item in the course, so students of the copy can open it, and staff of the copy open it through `GET /courses/:courseId/files/:fileId` (any module item of the course, published or not, a course share, or their own file; `CourseFileService`).

**Web.** Course Settings → *Copy and templates* has **Copy course** and **Import content**. Import picks a source from the caller's courses where they are teacher or admin plus the school's templates (`GET /courses/templates`), takes the same date options, asks for confirmation, then shows the `copied` counts and reloads the course.

## Templates

`course.course.is_template` (migration `20261023150000_course_templates`, partial index `course_school_template_idx` on `school_id WHERE is_template`). A template never has students:

- becoming a template is refused (409) while any non-dropped student is enrolled, and clears the join code;
- `POST /courses/:id/join-code` and `POST /courses/:id/students` answer 400;
- `CourseService.joinByCode` only matches `is_template = false`;
- `CourseAccessService.requireStudent` 404s a template and the portal course list filters them out.

Copying a template produces an ordinary course (`is_template = false`).

## Tests

`course-copy.service.test.ts` (repointing, date modes, access, import merge), `course.service.test.ts` (template rules), and the "course copy and templates" block of `scripts/smoke.ts`.
