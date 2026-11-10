---
sidebar_label: Course copy and templates
---

# Course Copy and Templates

**Location**: `backend/src/course/course-copy.service.ts`, `course-copy.controller.ts`, `course-snapshot.ts`, `course-file-copy.service.ts`, `dto/course-copy.dto.ts`; the template library in `backend/src/course/library/`

Copying a course's design into a new draft course, importing it into an existing course, school templates, and the course template library.

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

The design is read as a JSON **snapshot** (`readSnapshot` in `course-snapshot.ts`), optionally narrowed (`selectSnapshot`, library only) and written into the target with `writeSnapshot(tx, snapshot, ctx)`. Ids are minted before any insert, so pointers are repointed first and each table is one `createMany`, parents first:

| Source | Copy |
|--------|------|
| `assignment_group` | name, weight, position, drop rules. On import, a group whose name matches one in the target (case-insensitive, matching the unique index) is reused |
| `rubric`, `rubric_criterion`, `rubric_rating` | everything; `created_by` = copier |
| `question_bank` (+ its questions) | everything; draws (`quiz_bank_draw`) repointed |
| `activity` | design fields (kind, title, instructions, points, submission settings, attempts, time limit, Lockdown, shuffle, late policy, group, rubric), `status = 'draft'`, `published_at = null`, `due_at` and `late_until` shifted/cleared |
| `quiz_question`, `quiz_option` | everything, including numeric answers/tolerance, partial credit, matching labels, file-upload rules and an essay rubric |
| `page` | title, body, `is_published` kept |
| `module` | title, position (offset after the target's own on import), `is_published` kept |
| `module_item` | repointed to copied module/page/activity/discussion topic/**file copy**. A discussion item pointing at a student-started topic (not copied) is dropped |
| external tool items | copied with a new `lti_resource_link` only when the tool is enabled, `lti` is on for the target school and a deployment reaches it (that school's own, else the all-schools one); otherwise skipped with a note in the response (`notes`) |
| `discussion_topic` | staff-authored only; `is_published = false`, author = copier, no replies or reads |
| `discussion_setting` | on copy (not import) |
| learning outcomes | `copyOutcomeAlignments` from `src/mastery` (course outcomes and alignments onto the copied activities, rubric rows and questions) |

Course, page, activity, group and file ids appearing in page bodies, activity instructions and topic bodies are rewritten to the copy's ids (`relinkIds`), so in-course links stay in the copy.

Never copied: `course_student`, `course_staff` (the copier is the only teacher), submissions, marks, rubric assessments, peer reviews, attendance, extensions, accommodations, announcements, course notifications, discussion replies/reads, file shares, LTI deployments, `join_code`.

**Files are copied, never shared** (the decision on ROADMAP item 13). Before, a file item kept the source's file id, so whoever copied or imported a course could open the author's file through the new course. Now `CourseFileCopyService`:

1. checks every linked file against the target school's upload limit (`UploadLimitService`) and refuses with a 400 naming the files **before anything is written**;
2. reserves a `pending` `file_manager.file` row per file, owned by the copier, at `file-manager/<school>/<copier>/<new id>-<slug>`;
3. copies the bytes inside the bucket (`StorageService.copy`, never through the API);
4. marks the rows `ready` in the same transaction as the content.

If the transaction fails the reserved rows and objects are removed (and the retention job removes any `pending` row nobody links after an hour). The author's file id never appears in the copy.

Copy and import run in one interactive transaction (60s timeout).

**Web.** Course Settings → *Copy and templates* has **Copy course** and **Import content**. Import picks a source from the caller's courses where they are teacher or admin plus the school's templates (`GET /courses/templates`), takes the same date options, asks for confirmation, then shows the `copied` counts and reloads the course.

## Templates

`course.course.is_template` (migration `20261023150000_course_templates`, partial index `course_school_template_idx` on `school_id WHERE is_template`). A template never has students:

- becoming a template is refused (409) while any non-dropped student is enrolled, and clears the join code;
- `POST /courses/:id/join-code` and `POST /courses/:id/students` answer 400;
- `CourseService.joinByCode` only matches `is_template = false`;
- `CourseAccessService.requireStudent` 404s a template and the portal course list filters them out.

Copying a template produces an ordinary course (`is_template = false`).

## Course template library

`/api/library` (`src/course/library`, behind `course_copy`; see the [course README](../../../backend/src/course/README.md#template-library)). Publishing freezes a snapshot of a course, or chosen modules, activities, pages and rubrics, as an immutable **version** (`course.library_item_version`), and copies its files into the library's own storage (`course-library/<item>/<version>/`). Visible to the publisher's school, or (with `course-library:create`) to every school. Republishing adds a version; unpublishing hides the item. Importing (`POST /library/items/:id/import`) is a background job (`course.library_import`, BullMQ queue `course-library-import` with Redis, in-process otherwise) that copies the version's files into the importer's own storage with progress, then writes the content into an existing course (appended) or a new draft course in one transaction. Over-limit files fail the request before anything is written; re-runs are idempotent (fixed file ids per import, the content transaction locks the import row and stops once it is done) and a sweep resumes imports a restart left behind.

## Tests

`course-copy.service.test.ts` (repointing, date modes, access, import merge, file copies with new keys and owner, the upload-limit refusal before writes, clean-up on failure, excluded data), `library/library.service.test.ts` (publishing, visibility and cross-school isolation, versioning, import job, idempotency, LTI items, excluded data), `course.service.test.ts` (template rules), and the "course copy and templates" block of `scripts/smoke.ts`.
