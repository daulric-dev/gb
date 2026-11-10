# Similarity check (`src/similarity`)

Flags text submissions that closely match others in the same activity or, optionally, the same school. Behind the feature `similarity_check` (off by default; the organisation enables it and a school can switch it off). User guide: [work and grading](../../../docs/content/guide/work-and-grading.md#similarity-check).

**Owner decision:** a quiet, teacher-only marker and a side-by-side view. Never shown to students, never changes a grade, a prompt to look and not a verdict. No external databases; comparison only within the school.

## Algorithm (`fingerprint.ts`, pure)

1. **Normalise**: words (`\p{L}\p{N}\p{M}` runs) decomposed (NFKD), accents dropped, lower case, punctuation gone.
2. **Skip** texts under `MIN_WORDS` (50) words.
3. **Shingles**: every run of `SHINGLE_WORDS` (5) words, hashed with FNV-1a 32-bit (a Postgres `integer`).
4. **Subtract** every shingle that also occurs in the activity's instructions (and, for an essay answer, the question's prompt): quoting the prompt is never a match.
5. **Winnow** (window `WINNOW_WINDOW` = 4): the minimum hash of each window, distinct and sorted, stored in `similarity_fingerprint.hashes`.
6. **Candidates**: fingerprints sharing any hash (`hashes && $1`, GIN index), in the same school, not the same student's work; the same activity and part, or with the school pool also the school's courses in its latest `pool_terms` terms (by start date) and courses without a term.
7. **Score**: containment, the percent of one fingerprint's hashes found in the other's, stored both ways (`similarity_match`) when at least `STORE_FLOOR` (10%). The teacher's threshold (default 40%) filters on read.

`text_hash` (sha256 of the algorithm version, the normalised text and the subtracted texts) makes the job idempotent: an unchanged part is not recomputed. A part that disappears or becomes too short loses its fingerprint (matches cascade).

## The job

`SubmissionEvents` fires on every hand-in (assignment submit, quiz scored including the expiry sweep). `SimilarityQueueService` puts the submission on the BullMQ queue `similarity-check` with Redis (`USE_REDIS=true` + `REDIS_URL`; job id `similarity-<submissionId>`, 3 attempts, completed jobs removed) or runs it in-process after the request (`setImmediate`). `SimilarityService.process()` reads the submission's parts: an assignment's `text_body` (part `''`), a quiz's essay answers (part = question id). It runs per part in a transaction under `pg_advisory_xact_lock(hashtext('similarity:<schoolId>'))`, so two hand-ins in a school never miss each other. It does nothing while the feature is off for the school.

## HTTP routes

Teacher (`SimilarityController`, `AuthGuard`; staff role in the activity's course and the feature checked by the service). There is **no student route**.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/activities/:activityId/similarity` | `{ threshold, pool, note, flags[{ submissionId, studentId, count, maxScore }] }`, only above the threshold |
| GET | `/api/activities/:activityId/similarity/submissions/:submissionId` | That submission's matches above the threshold, best first; another course's student is named only to staff of that course |
| GET | `/api/activities/:activityId/similarity/compare/:fingerprintId/:otherId` | Side by side: both texts as `segments[{ text, match }]` (`highlight()`); for a course the caller does not teach, the other side has no name and only the shared passages (`matchingOnly()`) |

School settings (`SchoolSimilarityController`, `PermissionGuard` + `school:update`, the active school):

| Method | Path | What it does |
| --- | --- | --- |
| GET / PUT | `/api/schools/current/similarity` | `{ pool: 'activity' \| 'school', poolTerms 1-12, threshold 10-100 }` (`SimilaritySettingsDto`); defaults without a row: `activity`, 2, 40. Audited as `similarity_setting`. |

Every response carries `note`: wording that similarity is not proof.

## Services / exports

`SimilarityModule.forRoot()` exports `SimilarityService` (`settingsFor`, `getSchoolSettings`, `updateSchoolSettings`, `process`, `activityFlags`, `submissionMatches`, `compare`); `SimilarityQueueService.enqueue()`; `SimilarityProcessor` (Redis mode only).

## Used by

- `src/app.module.ts` imports `SimilarityModule.forRoot()`.
- Web (teachers only): `frontend/lib/similarity.ts`, the marker in `MarksTable.tsx` and `SimilarityDialog.tsx` (`frontend/app/dashboard/courses/[courseId]/assignments/_components/`), school settings `frontend/app/dashboard/settings/_components/school-similarity-settings.tsx`. Not in the mobile app.

## Depends on

`PrismaService`, `CourseAccessService`, `FeatureService`, `AuditLogService` (optional), `SubmissionEvents`, `@nestjs/bullmq` (Redis mode), `userSchoolId`.

## Data

`grading.similarity_fingerprint`, `grading.similarity_match`, `grading.similarity_setting` (`prisma/schema/similarity.prisma`, migration `20261125100000_similarity_check`). Fingerprints cascade with the submission. Reads `grading.submission`, `activity`, `quiz_answer`, `quiz_question`, `course.course`, `public.term`.

## Configuration

`USE_REDIS` / `REDIS_URL` (queue or in-process), as in [`src/queue`](../queue/README.md).

## Tests

`cd backend && bun test src/similarity`

- `fingerprint.test.ts`: normalisation (case, accents, punctuation, ligatures), token positions, stable 32-bit hashes, the same fingerprint whatever the formatting, winnowing, the short-text skip, instructions subtraction (and that it changes the text hash), scores, highlighting (and excluded prompt text).
- `similarity.service.test.ts`: the job (matches both ways, candidates limited to the school and other students, idempotent, short text drops the fingerprint, feature off), the threshold (school's and the 40% default), staff-only (a student gets 404, feature off 403), cross-school and cross-activity matches refused, another course's work shown as passages only and unnamed, and a scan that no student-facing code (portal, parent portal, peer review portal, portal mappers) touches similarity data.
