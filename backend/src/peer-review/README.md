# Peer review (`src/peer-review`)

Students review classmates' submissions to an assignment, against a course rubric or with comments only, optionally anonymously. Behind the feature `peer_review` (on by default). User guide: [work and grading](../../../docs/content/guide/work-and-grading.md#peer-review).

## Rules

- **Settings** (one row per assignment, `grading.peer_review_setting`): on/off, reviews per student N (1-10), anonymous, opening (`after_due`: at the activity's due date, which it needs; `manual`: when a teacher starts it), close date (after the opening and in the future), the review form (a rubric from the same course, or null for comments only), and review-quality points. Assignments only.
- **Window** (`windowState()` in `allocation.ts`): `scheduled` (after_due, not yet due), `not_started` (manual, not started), `open` (from the opening until `closes_at`), `closed`. `started_at` is stamped when reviews are first allocated.
- **Opening** happens on the first of: the sweep (`PeerReviewScheduler`, once a minute, database lease `gradebook:peer-review-sweep`), any read of the activity's peer review (staff overview, the student's view), or **Start** (`POST .../start`, manual or early).
- **Allocation** (`allocate()`): the reviewers and the reviewed are the submitters: `submitted_at` set, status `submitted`/`graded`, not excused, enrolment not dropped. The first run is a ring over a seeded order (`rankKey(seed, studentId)`): each reviews the next k = min(N, submitters − 1); everyone reviews exactly k and receives exactly k; never self. The result is stored (`grading.peer_review_allocation`), so it never reshuffles. **Late joiners** (a hand-in while the window is open, via `SubmissionEvents`; or **Start** again, "Allocate late submitters") get `topUpAllocation()`: each submitter short of k reviews the submissions with the fewest reviews (so late joiners review each other first), then each submission short of k gets the lightest-loaded reviewers, capped at k + 1. Deterministic, and running it again adds nothing. A per-activity persisted database lease serializes allocation. Raising N after the start tops up; lowering it is refused.
- **Reviewing** (portal): only the assigned reviewer can open an allocation (anyone else, the author included, gets 404). They see the classmate's text and files; a file is served only if it belongs to that submission, with the staff marking view's headers (`nosniff`, `Content-Security-Policy: sandbox`, inline only for PDF/images/text). Saving needs the window `open` (409 otherwise); rubric marks are validated (`validateMarks`: a level gives its points, bare points within the criterion's, every criterion to hand in); a comment-only review needs a comment. `submit` hands it in; it stays editable until the close.
- **Anonymity**: anonymous reviews never send the author's name to the reviewer, nor the reviewer's name to the author, and files are renamed `Attachment N.<ext>` (names often carry the student's name). Once started, anonymous cannot be turned off.
- **Authors** see their received reviews only once `closed`: handed-in, not hidden.
- **Staff** (teacher, TA, course admin) see every allocation and review, drafts included, and can **hide** a review from its author (`hidden`, reason, `hidden_at`; audited as `peer_review_allocation`). Teachers (manage roles) change settings, start, add, reassign (not once handed in) and remove allocations; all audited.
- **Review quality** (the chosen model): with `qualityPoints`, the module creates a published **offline** activity "Peer review: <title>" in the course (`quality_activity_id`) worth those points. Teachers mark each reviewer there with the normal marking routes, so the mark lives in `submission.score` like any other and appears in the gradebook, CSV and report cards. The assignment's own marks never change. Changing the points updates the column (refused if a mark would exceed them); turning it off deletes the column when nobody has a mark in it, otherwise unlinks it and leaves it as ordinary offline work.
- **Notifications** (`CourseNotificationService`): `peer_review_assigned` to new reviewers on allocation; `peer_review_ready` to authors with at least one visible review, once, by the sweep after the close (`ready_notified_at`; a later close date resets it). Push `data.type` is `course.peer_review` with `courseId` and `activityId`.

## HTTP routes

Staff (`peer-review.controller.ts`, `AuthGuard`; role and feature checked by the service against the activity's course):

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/activities/:activityId/peer-review` | Staff | `{ activityId, settings \| null, rubric, reviews[], submitters[] }`; opens a due window first |
| PUT | `/api/activities/:activityId/peer-review` | Manage | Create or change settings (`PeerReviewSettingsDto`). Audited as `peer_review_setting`. |
| POST | `/api/activities/:activityId/peer-review/start` | Manage | Open now, or allocate late submitters |
| POST | `/api/activities/:activityId/peer-review/reviews` | Manage | Add a review (`AddAllocationDto`); 400 for the author, 409 for a duplicate |
| PATCH | `/api/activities/:activityId/peer-review/reviews/:allocationId` | Manage | Reassign (`ReassignAllocationDto`); 409 once handed in |
| DELETE | `/api/activities/:activityId/peer-review/reviews/:allocationId` | Manage | Remove (`204`) |
| PATCH | `/api/activities/:activityId/peer-review/reviews/:allocationId/hidden` | Staff | Hide or show (`HideReviewDto`), audited |

Students (`portal-peer-review.controller.ts`, `AuthGuard` + `StudentGuard` + `FeatureGuard`, `@RequireFeature('peer_review')`):

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/portal/me/peer-reviews` | Reviews to do in open windows, across courses |
| GET | `/api/portal/me/activities/:activityId/peer-review` | `{ enabled: false }` or the window, rubric, `assigned[]` and (closed) `received[]` |
| GET | `/api/portal/me/peer-reviews/:allocationId` | The classmate's work and the reviewer's draft |
| PUT | `/api/portal/me/peer-reviews/:allocationId` | Save (`SaveReviewDto`: `comment`, `marks`, `submit`) |
| GET | `/api/portal/me/peer-reviews/:allocationId/files/:fileId` | One file of the reviewed submission, sandboxed |

## Services / exports

`PeerReviewModule` exports nothing. `PeerReviewService`: `overview`, `updateSettings`, `start`, `addAllocation`, `reassign`, `removeAllocation`, `setHidden`, `submitters`, `allocateNow`, `onHandedIn`, `sweep`, `listForStudent`, `activityForStudent`, `reviewForStudent`, `saveReview`, `readReviewFile`. Pure helpers in `allocation.ts`: `ringAllocation`, `topUpAllocation`, `allocate`, `reviewsEach`, `rankKey`, `windowState`, `opensAt`, `shouldOpen`, `validateMarks`, `anonymousFileName`.

## Used by

- `src/app.module.ts` imports `PeerReviewModule`.
- Web: `frontend/app/dashboard/courses/[courseId]/assignments/_components/PeerReviewPanel.tsx` (the assignment's **Peer review** tab), `frontend/app/portal/_components/peer-review-section.tsx` (work page), `frontend/app/portal/peer-reviews/[allocationId]/page.tsx`, `frontend/components/peer-review/`, `frontend/lib/peer-review.ts`.
- Mobile: `mobile/src/features/work/PeerReviewSection.tsx` (work screen), `mobile/app/peer-review/[allocationId].tsx`, `mobile/src/lib/peer-review.ts`.

## Depends on

`PrismaService`, `CourseAccessService`, `FeatureService`, `FileManagerService` (`FileManagerModule`), `CourseNotificationService` and `AuditLogService` (optional), `SubmissionEvents` (`src/grading/submission-events.ts`), `loadRubric` from `src/grading/rubric.service.ts`, `StudentGuard`.

## Data

`grading.peer_review_setting`, `grading.peer_review_allocation` (`prisma/schema/peer-review.prisma`, migration `20261124100000_peer_review`). Reads `grading.activity`, `submission`, `submission_file`, `rubric*`, `course.course_student`, `student.student`, `file_manager.file`; writes an offline `grading.activity` for review quality and `course.course_notification` (through the notification service).

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `PEER_REVIEW_SWEEP` | `true` | `false` stops the scheduler (reads still open a due window). Never runs under `NODE_ENV=test`. |

## Tests

`cd backend && bun test src/peer-review`

- `allocation.test.ts`: the ring (everyone reviews N and receives N for many sizes, never self, N capped, deterministic under any input order, seed matters), late joiners (N each way, nobody above N + 1, joiners review each other first, existing rows never move, re-running adds nothing, excused students drop out), the window states, rubric mark validation, anonymous file names.
- `peer-review.service.test.ts`: IDOR (another student, the author, an unrelated file, unenrolled), anonymity both ways (names and file names), not-yet-open, feature/setting off, saving while open and refused after close, comment required, received only after close and never hidden, named reviews, hiding (audited, staff only, another activity's review), settings validation and permissions, the review-quality column, submitter exclusions, opening (stored allocation, start stamp, notices), self-review and reassigning a handed-in review refused, the ready sweep.
