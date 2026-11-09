# Report cards (`src/report-card`)

Term report cards and transcripts, behind the `report_cards` feature (default on; the organisation can make it unavailable and a school admin can switch it off). User guide: [docs/content/guide/report-cards.md](../../../docs/content/guide/report-cards.md).

A **report period is a term** (`public.term`). For each term:

1. Teachers write one comment per student per course and tick it **ready** (a table per course).
2. A school admin watches completion per course, sets an optional comment deadline, writes the head / form tutor comment per student, and previews any student's report.
3. The admin **publishes**. Students see the term's reports from then on, and one PDF per student is generated in a background job and stored in object storage. **Unpublish** hides them again and unlocks comments; publishing again regenerates every PDF.
4. Students and their parents (parent portal) list and download their published reports, and see a **transcript** across every published term.

## How a course maps to a term (and its final grade)

`courseTermMode()` in `report-card.calc.ts`:

| Course | On which term reports | Final grade |
| --- | --- | --- |
| `course.term_id` = the term | That term only | The course's whole gradebook |
| `term_id` null, `academic_year_id` = the term's year (a year-long course) | Every term of that year | Cumulative to the term's end: only work due on or before the term's last day (undated work by when it was created) |
| Any other | Not on the report | - |

Drafts (`course.status = draft`) and templates never get reports; archived courses do. Students are those `active` or `completed` in a course.

The grade itself is the gradebook's calculation (`calculateCourseGrade` in `src/grading/gradebook.calc.ts`): only marked, published/closed work; excused and omitted work left out; weights renormalised over groups with marks; drop rules applied. The letter comes from `letterFor()` with the course's grade scale, else the school's default scale, exactly as the gradebook does. So a report shows the number a teacher sees in the gradebook (for a term course) or the gradebook restricted to the term (for a year course).

The attendance summary counts the student's `course.attendance_record` statuses (present, late, absent, excused) for sessions opened between the term's first and last day in any course of the school. Only the status column is read: no location data.

## HTTP routes

All behind `AuthGuard` + `FeatureGuard` with `@RequireFeature('report_cards')` (403 `FEATURE_DISABLED` when off), except the signed-link route (below).

### Teacher comments (`report-comment.controller.ts`)

Access is the caller's course role (`CourseAccessService`): any staff role reads; `MANAGE_ROLES` (teacher of the course, or a course admin holding `course:update`) writes. TAs read only. Not a course member: 404.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/courses/:courseId/report-comments?termId=` | `{ course, terms, term, deadline, publishedAt, canEdit, students[{ studentId, firstName, lastName, percent, letter, comment, status, updatedAt }] }`. Without `termId`: the term containing today, else the latest started, else the first of the course's terms. 404 for a term the course does not report in. |
| PUT | `/api/courses/:courseId/report-comments` | `SaveReportCommentsDto` `{ termId, comments[{ studentId, body (≤ 2000), status draft|ready }] }`, upserted in one transaction. 400 for a student not enrolled, a duplicate, or `ready` with an empty comment; 409 while the term is published. |

The deadline is advisory: it is shown to teachers and on the dashboard, and does not block saving.

### Release dashboard (`report-release.controller.ts`)

In the caller's active school, behind `PermissionGuard`: `report-card:read` to look, preview and download; `report-card:update` to change. Admins hold both. A term of another school is 404.

| Method | Path | Permission | What it does |
| --- | --- | --- | --- |
| GET | `/api/report-cards/terms` | read | Every term of the school with `commentDeadline` and `publishedAt` |
| GET | `/api/report-cards/terms/:termId` | read | Overview: release state, `courses[{ courseId, name, code, teachers, yearLong, students, ready, draft, missing }]`, totals, `documents { pending, ready, failed }`, `generationMode` (`queue` or `inline`) |
| PATCH | `/api/report-cards/terms/:termId` | update | `{ commentDeadline: ISO | null }` |
| GET | `/api/report-cards/terms/:termId/students` | read | Students on the term with their head comment and PDF state |
| PUT | `/api/report-cards/terms/:termId/head-comments` | update | `{ comments[{ studentId, body }] }`; 409 while published, 400 for a student not on the term |
| GET | `/api/report-cards/terms/:termId/students/:studentId/preview` | read | The report drawn now (inline PDF); marked "PREVIEW" until published |
| GET | `/api/report-cards/terms/:termId/students/:studentId/file` | read | The stored PDF |
| POST | `/api/report-cards/terms/:termId/publish` | update | Publish and queue generation (409 if already published). Audited (`report_release`). |
| POST | `/api/report-cards/terms/:termId/unpublish` | update | Unpublish (409 if not published). Audited. |
| POST | `/api/report-cards/terms/:termId/regenerate` | update | `{ failedOnly? }`: generate again (published terms only) |
| GET | `/api/report-cards/terms/:termId/reports.zip?courseId=` | read | Every ready PDF of the term, or of one course's students (a class), as a zip; students without a PDF yet are listed in `missing.txt` |
| GET | `/api/report-cards/students/:studentId/transcript` (`.pdf`) | read | A student's transcript over every term, published or not |

### Student portal (`portal-report.controller.ts`)

`AuthGuard`, `StudentGuard`, `FeatureGuard`. No route takes a student id: it is `req.student.studentId`.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/portal/me/reports` | The student's reports in published terms, newest first: `{ id, termId, termName, yearName, startDate, endDate, publishedAt, status }` |
| GET | `/api/portal/me/reports/:documentId/file` | The PDF (used by the web download and the mobile `downloadAndOpen`) |
| GET | `/api/portal/me/reports/:documentId/link` | `{ url, expiresAt }`: a five-minute signed link (below) |
| GET | `/api/portal/me/transcript` (`.pdf`) | The transcript over published terms only |

### Signed links (`report-link.controller.ts`)

`GET /api/report-cards/files/:token` - no session. The token (`report-link.ts`) names one `report_document` and its school, expires after 5 minutes, and is HMAC-SHA256 signed with a key derived from `AUTH_SECRET` (rotating it invalidates outstanding links, which is harmless). On use, the feature, the publish state, the document's status and its storage key's school prefix are all checked again. Throttled to 60 a minute per client.

Every PDF response carries `Content-Type: application/pdf`, a safe `Content-Disposition`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox` (`report-file.ts`), like other files the API serves.

## Generation, storage and the queue

- **Where:** `report-cards/schools/<schoolId>/terms/<termId>/<studentId>.pdf` (`report-keys.ts`), in the one bucket via `StorageService`. The key is deterministic, so a retried job or a re-publish overwrites in place. Reading always goes through `assertKeyInSchool()`.
- **Rows:** `grading.report_document` (one per term and student): `pending` → `ready` (with key, size, `generated_at`) or `failed` (with the error, after the last attempt).
- **Jobs** (`report-generation.service.ts`): publishing upserts every student's row as `pending` and enqueues one job per student.
  - With Redis (`USE_REDIS=true` and `REDIS_URL`): BullMQ queue `report-card-generate` (`ReportCardProcessor`), 3 attempts with exponential backoff (5 s base). The job id is `report-<term>-<student>-<publish time>`, so enqueuing the same publish twice adds nothing.
  - Without Redis: the same jobs run in this process after the publish request has answered, one student at a time, each with 3 attempts. A batch runs after any earlier one, so two publishes never interleave.
  - A job does nothing if the term was unpublished meanwhile or the school switched the feature off.
- **Resuming after a restart** (`ReportGenerationScheduler`, `ReportGenerationService.resumeStale`): each attempt first records itself on the row (`attempts` = the attempt number, `updated_at` = now), and an inline batch touches the rows it still holds every 2 minutes (heartbeat). On boot (`OnApplicationBootstrap`) and every 5 minutes, one instance at a time (Postgres advisory lock `gradebook:report-card-resume`, like the retention and parent notice schedulers), the sweep takes up to 500 `pending` rows of **currently published** terms whose `updated_at` is older than 10 minutes, claims them (touches `updated_at`) and re-runs each with the attempts it has left (`attemptOffset`); a row that used all 3 is marked `failed` ("stopped before it finished") for **Retry failed**. Schools with the feature off are skipped; rows this process still holds are skipped.
  - Inline: rows a stopped process left behind are picked up within about 15 minutes of the restart.
  - Redis: a job lost before it was enqueued (a crash between publish and `addBulk`) or lost from Redis is put back (job id `report-resume-<term>-<student>-<time>`, attempts left only), but only once the queue has no waiting, delayed or running jobs: publish and regenerate use different job ids, so a pending row is taken as lost only when nothing is left to run it. Stalled jobs of a dead worker are BullMQ's own retry.
  - Reruns are safe: the storage key is fixed and overwritten, and the row is upserted.
  - Off under `NODE_ENV=test` or with `REPORT_GENERATION_SWEEP=false`.
- **Bulk:** downloads are a zip built on request from the stored PDFs with `archiver` (already a dependency for hand-in archives), per course or per term. Generation itself is never done in a request except for one-off previews and transcripts.

## PDF

`report-pdf.ts` draws A4 PDFs with [`@pdfme/pdf-lib`](https://github.com/pdfme/pdfme) (the maintained fork of pdf-lib: pure JavaScript, no native build, works under Bun). Report: school logo and name, term and dates, the student, each course with teachers, grade, letter and the teacher's comment, the attendance summary, and the head comment. Transcript: every term with its courses, grades and letters.

**Fonts** (`report-fonts.ts`): Noto Sans Regular and Bold (SIL OFL 1.1) are bundled in [`fonts/`](fonts/README.md) (source, version and SHA-256 there) and embedded with [`fontkit`](https://github.com/foliojs/fontkit) 2 (the fontkit `@pdfme/pdf-lib` is built for; pure JavaScript) as a **subset**, so a PDF stays around 10-20 KB. They cover Latin with Latin Extended and Vietnamese, Greek and Cyrillic. Text is NFC-normalised and drawn without `ccmp` decomposition (pdf-lib does not position marks), so "Nguyễn" keeps its precomposed letters. `REPORT_PDF_EXTRA_FONT` (a `.ttf`/`.otf` path) adds a fallback for what Noto Sans lacks (CJK, Arabic, ...); it is embedded only in documents that need it, and text is measured and drawn in runs per font. A character no font has is drawn as U+FFFD and logged once per document (without the student's name). If the bundled fonts cannot be read, the PDF falls back to Helvetica (Latin only: folded or "?") and logs an error. `nest build` copies `fonts/` to `dist` (`nest-cli.json` assets).

**Logos** (`report-logo.ts`): PNG and JPEG are embedded as stored. WebP (the only other format the image pipeline accepts) is converted to PNG (at most 512 px) with `sharp` **when the deployment has it**: sharp is not a backend dependency (a large native package), so it is loaded at run time and, without it, WebP logos are left off with one log line. A failed conversion, or anything else (SVG, unknown bytes), leaves the logo off and logs; the report is never affected.

## For the parent portal

`ReportCardModule` exports `StudentReportsService` (`forRoot()` returns one cached module, so the parent portal imports the same instance). Given a student id the caller has already authorised (for a parent, one of their linked children):

- `publishedReportsFor(studentId)` - the list above.
- `openReport(studentId, documentId)` - `{ body, size, filename }` to stream with `sendPdf()` from `report-file.ts`.
- `createDownloadLink(studentId, documentId)` - a signed link.
- `transcriptFor(studentId)` / `transcriptPdfFor(studentId)`.

The parent portal serves them under `/api/parent/children/:studentId/reports` and `/transcript` (see [`src/parent-portal`](../parent-portal/README.md)).

## Data

[`prisma/schema/report.prisma`](../../prisma/schema/report.prisma), migration `20261113100000_report_cards`:

| Table | Holds |
| --- | --- |
| `grading.report_release` | One per `(school_id, term_id)`: `comment_deadline`, `published_at`, `published_by` |
| `grading.report_comment` | One per `(term_id, course_id, student_id)`: `body` (≤ 2000, CHECK), `status` (`report_comment_status`: `draft`/`ready`), `author_id` |
| `grading.report_head_comment` | One per `(term_id, student_id)`: `body`, `author_id` |
| `grading.report_document` | One per `(term_id, student_id)`: `status` (`report_document_status`), `storage_key`, `byte_size`, `attempts`, `error`, `generated_at` |

Everything cascades with its school, term, course or student; authors and publishers are set null when their profile goes.

Reads: `public.term`, `public.academic_year`, `public.school` (name, `logo_path`), `course.course`, `course.course_staff`, `course.course_student`, `course.assignment_group`, `grading.activity`, `grading.submission`, `grading.grade_scale(_band)`, `course.attendance_record` (status only), `student.student`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `REPORT_GENERATION_SWEEP` | `true` | `false` stops the resume sweep. |
| `REPORT_PDF_EXTRA_FONT` | - | Path to an extra font for characters Noto Sans lacks. |

`USE_REDIS` / `REDIS_URL` choose the queue mode; `AUTH_SECRET` keys the signed links; `S3_*` is the storage.

## Files

| File | Purpose |
| --- | --- |
| `report-card.module.ts` | `ReportCardModule.forRoot()`: queue registration in Redis mode, controllers, providers; exports `StudentReportsService` |
| `report-card.calc.ts` | Pure rules: term mapping, final grade per course, attendance summary, completion, names |
| `report-data.service.ts` | Loads terms, courses, enrolments, grades, comments, attendance and branding |
| `report-comment.service.ts`, `report-comment.controller.ts` | Teacher comments |
| `report-release.service.ts`, `report-release.controller.ts` | The release dashboard |
| `student-reports.service.ts`, `portal-report.controller.ts` | Student (and future parent) access |
| `report-link.ts`, `report-link.controller.ts` | Signed download links |
| `report-generation.service.ts`, `report-card.processor.ts`, `report-card.constants.ts` | Background generation |
| `report-generation.scheduler.ts` | Resume sweep (boot + every 5 minutes, advisory lock) |
| `report-pdf.ts` | PDF drawing |
| `report-fonts.ts`, `fonts/` | Bundled Noto Sans, the extra font, replacement characters |
| `report-logo.ts` | Logo bytes for the PDF (WebP to PNG with sharp when available) |
| `report-keys.ts` | Storage keys and the school-prefix check |
| `report-file.ts` | PDF response headers |
| `dto/report-card.dto.ts` | Request DTOs |

## Tests

```bash
cd backend && bun test src/report-card
```

- `report-card.calc.test.ts`: term mapping, cutoff, final grade and letter (excused, omitted, weighted, drafts, year cutoff, no scale), attendance, completion, file names.
- `report-pdf.test.ts`: the PDF loads in pdf-lib and contains the expected text (`src/test/pdf-text.ts` extracts it, through the fonts' ToUnicode maps), page breaks, names in Latin Extended, Vietnamese, Greek and Cyrillic drawn exactly in subset Noto Sans, decomposed input, CJK/Arabic replaced and logged once, the extra font (skipped where the machine has no wide system font), font runs, the Helvetica fallback, logos (PNG/JPEG as-is, a generated WebP converted, a failed conversion or unknown format left off), transcript.
- `report-generation.resume.test.ts`: the sweep's query (pending, stale, published only), claim, remaining attempts (inline and queue), exhausted rows marked failed, feature off skipped, rows held by this process skipped and kept fresh by the heartbeat, queue busy left alone, lost jobs re-added, the worker's attempt numbering, the scheduler's lock and boot run.
- `report-comment.service.test.ts`: teacher writes; TA reads only (403); other teachers and ex-members 404; not enrolled, empty ready and duplicates 400; locked while published (409).
- `report-release.service.test.ts`: generation into the school-scoped key with the expected content, idempotent re-runs, skip when unpublished or the feature is off, pending-then-failed on retries, inline retries, queue job ids; publish/unpublish visibility to students, ownership, keys outside the school (403), pending documents, signed links (tamper, expiry, unpublish, feature off, wrong school), other schools' terms 404, head comment rules, overview completion, preview.
- `report-card.guard.test.ts`: every route answers 403 `FEATURE_DISABLED` with the feature off (school or organisation), and admin routes carry the right `report-card:*` permission.
