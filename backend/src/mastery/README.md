# Mastery (`src/mastery`)

Mastery / standards-based grading: learning outcomes, a school proficiency scale, alignment of outcomes to what measures them, evidence from marks, and each student's mastery per outcome. Behind the **`mastery`** feature (off by default; the organisation makes it available and a school can switch it off). User guide: [docs/content/guide/mastery.md](../../../docs/content/guide/mastery.md).

**Alongside the points gradebook.** Nothing here changes a score, a course total, a letter, the gradebook CSV or a report card grade. Outcomes are an extra layer read from the same marks.

## Concepts

| Thing | Where | Notes |
| --- | --- | --- |
| **Outcome set** | `grading.outcome_set` | School-level framework (for example a curriculum). Archive, never lose evidence. |
| **Outcome** | `grading.outcome` | `code`, `title`, `description`, optional `subject` / `grade_level`, nested by `parent_id`. Belongs to a set (school outcome) **or** a course (`course_id`, course outcome); a CHECK enforces exactly one. |
| **Proficiency scale** | `grading.mastery_setting` (one per school; defaults without a row) | Level labels (2-10, value = position), mastery threshold, calculation, decaying-average weight, minimum evidence, score bands, report-card section switch. |
| **Alignment** | `grading.outcome_alignment` | An outcome linked to a whole **activity**, a **rubric row** (criterion) or a **quiz question** (own or bank) in a course; exactly one (CHECK `num_nonnulls = 1`), unique per outcome and target. |
| **Evidence** | `grading.outcome_evidence` | One row per (alignment, submission): `source`, `ratio` (0..1), rubric `rating_rank` / `rating_count`, `assessed_at`. |

## Evidence

`refreshOutcomeEvidence(tx, activityId, studentIds?)` in `outcome-evidence.ts` is **the one place** marks become evidence. It recomputes the evidence of an activity's submissions in the caller's transaction and writes only the difference (create, update, delete). It is called wherever a mark is written:

| Path | Where |
| --- | --- |
| Teacher mark (`grade()`, `gradeSubmission()`), late-penalty waiver, essay/file question marking | `SubmissionService.withLateness()` |
| **LTI score passback** | `LtiAgsService` calls `SubmissionService.grade()`, so it is covered above |
| Quiz submit and expiry (shared TypeScript scoring) | `SubmissionService.afterQuizScored()` |
| Excuse / un-excuse | `SubmissionService.excuse()` |
| Rubric marking | `RubricService.assess()`, **after** the criterion marks are rewritten |
| Gradebook CSV import | `GradebookImportService.apply()`: right after the batch transaction (a failure is logged, never undoes the import) |
| Activity points changed | `ActivityService.update()` |
| New alignment | `OutcomeService.align()` (for every activity the target was already marked on) |

Rules:

- Only `graded`, **not excused** submissions are evidence; anything else has its evidence removed.
- **Whole activity:** the mark before any late penalty (`raw_score`, else `score` for imported or old marks) over the activity's points.
- **Rubric row:** the assessment of that criterion: the chosen rating's rank among the criterion's ratings (lowest points first, ties by position) and its points over the criterion's points. Bare points (no rating) use the ratio.
- **Quiz question:** the question's credit 0..1 (`questionCredit()` from `src/grading/quiz-questions.ts`), only for questions the student's attempt was given (`quiz_attempt_question`; older attempts: the quiz's own questions). An essay or file question still waiting for its mark is skipped.
- `assessed_at` is `graded_at`, else `submitted_at`, else `updated_at`, so a re-mark moves the evidence to "now".
- **Late penalties never affect evidence**: mastery measures learning, not punctuality. The points gradebook still applies them.
- Removing an alignment removes the evidence it produced (cascade). Deleting a rubric removes its criteria, their alignments and evidence; scores stay on submissions as before.
- Cheap when nothing is aligned: one alignment query, then it returns.

## Levels and mastery (`mastery.calc.ts`, pure)

- **Evidence → level** (`evidenceLevel`): a rubric rating with a rank maps proportionally onto the scale (`levelForRank`: lowest rating = level 1, highest = top level, rounded between; one to one when the counts match). Everything else uses the **score bands** (`levelForPercent`: the band with the highest `minPercent` at or below the percent). Levels are worked out **when read**, so editing the scale applies to all past evidence at once.
- **Calculation** (`masteryScore`), per student per outcome, evidence oldest to newest by `assessed_at`:
  - `most_recent`, `highest`, `mean`;
  - `decaying_average` (default, weight `w` = 0.65): start with the first level, then `avg = avg × (1 − w) + level × w` for each newer one. [2, 3, 4] → 2.65 → **3.5275**.
- **Level of a score** (`levelForScore`): the highest level at or below it (3.53 is level 3).
- **Status** (`calculateMastery`): `mastered` when the score reaches the threshold **and** there are at least `minEvidence` items; `needs_more_evidence` when it reaches the threshold with too few; `not_yet`; `no_evidence`. Scores are rounded to two decimals for display.
- **Outcome CSV** (`parseOutcomeCsv`, `parentsFirst`): header with `code` and `title` (aliases `id`, `name`, `outcome`), optional `description`, `subject`, `grade_level`, `parent_code` (parent must be in the file); duplicates, unknown parents and loops are errors; at most 2000 rows. Parsing reuses the gradebook's RFC 4180 `parseCsv`.

## HTTP routes

All behind `AuthGuard` + `FeatureGuard` with `@RequireFeature('mastery')`.

### School (`MasterySchoolController`, `/api/mastery`, `PermissionGuard`, caller's active school)

| Method | Path | Permission | What it does |
| --- | --- | --- | --- |
| GET | `/api/mastery/settings` | `school:read` | The scale (`levels[{ value, label }]`, `masteryThreshold`, `calculation`, `decayWeight`, `minEvidence`, `scoreBands`, `reportCardSection`) |
| PUT | `/api/mastery/settings` | `school:update` | Any subset (`MasterySettingsDto`); the result must be a valid scale (400 otherwise). Changing the number of levels without bands spreads bands evenly. |
| GET | `/api/mastery/outcome-sets?includeArchived=` | `school:read` | Sets with `outcomeCount` |
| POST | `/api/mastery/outcome-sets` | `school:update` | Create (`title` unique per school, 409) |
| POST | `/api/mastery/outcome-sets/import` | `school:update` | CSV import into a new set (`title`) or an existing one (`setId`: same code updates). All or nothing (400 with `errors`); `dryRun` returns `{ created, updated, errors }`. |
| GET | `/api/mastery/outcome-sets/:setId` | `school:read` | The set and its outcomes (flat, with `parentId` and `evidenceCount`) |
| PATCH | `/api/mastery/outcome-sets/:setId` | `school:update` | Rename, describe, `archived` |
| DELETE | `/api/mastery/outcome-sets/:setId` | `school:update` | 409 once any outcome in it has evidence |
| POST | `/api/mastery/outcome-sets/:setId/outcomes` | `school:update` | Add (`OutcomeDto`); a parent must be in the same set |
| PATCH | `/api/mastery/outcome-sets/:setId/outcomes/:outcomeId` | `school:update` | Edit, move (no loops), `archived` |
| DELETE | `/api/mastery/outcome-sets/:setId/outcomes/:outcomeId` | `school:update` | 409 with evidence (archive instead); children move up a level |

A set or outcome of another school is a 404.

### Course (`MasteryCourseController`, `/api/courses/:courseId`, course role via `CourseAccessService`)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/outcomes` | Staff | `{ canEdit, own, school, alignments, targets }`: the course's outcomes, the school's (from sets not archived), the alignments, and what can be aligned (activities with their rubric rows and quiz questions) |
| POST / PATCH / DELETE | `/outcomes[/:outcomeId]` | Manage | Course outcomes; delete is 409 with evidence |
| POST | `/outcome-alignments` | Manage | `{ outcomeId, activityId \| criterionId \| questionId }`. The outcome must be the course's own or a school outcome of the course's school and not archived; the target must be in the course (rubric of the course; quiz or question bank of the course). Duplicate 409. Evidence is worked out at once. |
| DELETE | `/outcome-alignments/:alignmentId` | Manage | Removes it and its evidence |
| GET | `/mastery` | Staff | The grid: `{ course, scale, outcomes, students[{ id, firstName, lastName, studentNumber, masteredCount, cells[{ outcomeId, score, level, label, status, mastered, evidenceCount }] }] }` (active and completed students) |
| GET | `/mastery/export` | Staff | CSV, one row per student, a column per outcome (`Proficient (3.3) mastered`), cells through `csvCell()` (formula-safe) |
| GET | `/mastery/students/:studentId` | Staff | One student: each outcome's mastery and evidence timeline |

"Staff" is `STAFF_ROLES` (teacher, TA, course admin); "Manage" `MANAGE_ROLES`. A TA reads only (403); no role is 404.

The outcomes a course tracks (`courseOutcomeColumns`): its own (archived ones only while they have evidence there) plus school outcomes it aligns to or has evidence on.

### Student (`PortalMasteryController`, `/api/portal/me/outcomes`, `StudentGuard`)

The student's outcomes in every course they see (enrolled and not dropped; published or archived; not templates), with evidence: activity title, what was assessed (rubric row title or question prompt), level, percent and date. No feedback, answers or anything about other students.

### Parent

`GET /api/parent/children/:studentId/outcomes` lives in `src/parent-portal` (`ParentMasteryController`): `parent_portal` **and** `mastery` for the child's school, `ParentGuard`, and the school's **`showMastery`** parent setting (**default off**; 403 `PARENT_VIEW_HIDDEN`, nothing read). Same body as the student route, from `MasteryService.studentOutcomes()`.

### Report cards

`loadReportOutcomes()` (`mastery-report.ts`) is called by `ReportDataService.reportOutcomes()` in `src/report-card` when the `mastery` feature is on **and** the school's `report_card_section` is on: per course, each outcome with evidence and its level label and whether mastered. Year-long courses count evidence up to the term's last day. The PDF lists them under each course.

## Course copy and templates

`copyOutcomeAlignments(tx, { sourceCourseId, targetCourseId, activityIds, criterionIds?, questionIds?, userId? })` in `outcome-evidence.ts` is for the course copy / template import code to call inside its transaction once it knows the source → copy id maps. It copies the course's own outcomes (parents first; archived ones only when still used), re-points alignments at the copies, keeps school outcomes when both courses are in the same school (skipped otherwise) and **never copies evidence**. It is not wired into `src/course` yet; that code is being reworked separately.

## Audit log

Every staff write here is recorded with `AuditLogService.record` (injected `@Optional()`) inside the same transaction as the write, scoped to the school (course outcomes and alignments use the course's school):

| Entity | Actions | Changes |
| --- | --- | --- |
| `mastery_setting` | `create` (first save), `update` | `levels`, `mastery_threshold`, `calculation`, `decay_weight`, `min_evidence`, `score_bands`, `report_card_section`; only changed fields on update. `entityId` is the school id (one row per school). |
| `outcome_set` | `create`, `update` (title, description, `archived`), `delete` | Set fields; a delete also records `outcome_count` (its outcomes go with it). |
| `outcome_set` (CSV import) | `create` for a new set, `update` for an existing one | **One entry per import**, never one per row: `import: { created, updated, source: 'CSV import' }` (plus `title` / `source` for a new set). Dry runs and refused files write nothing. |
| `outcome` | `create`, `update` (including `archived`), `delete` | `set_id` / `course_id`, `parent_id`, `code`, `title`, `description`, `subject`, `grade_level`, `position`, `archived`. School and course outcomes alike. |
| `outcome_alignment` | `create` (link), `delete` (unlink) | `outcome_id`, `course_id` and the one target (`activity_id`, `criterion_id` or `question_id`). |

**Evidence is not audited.** `refreshOutcomeEvidence()` rows are derived data recomputed from marks on every mark write, alignment and re-mark (high volume, and fully reproducible). The changes that cause them are audited already: alignments here, and marks, rubric assessments, extensions and imports in `src/grading`. Refused writes (409 with evidence, 404, 400) record nothing.

## Services / exports

- `MasteryModule` exports `MasteryService` (used by the parent portal).
- `MasteryService`: `scale()`, `settings()`, `updateSettings()`, `courseOutcomeColumns()`, `grid()`, `exportCsv()`, `studentDetail()`, `studentOutcomes()`. Module helpers `toWireScale()`, `masteryByStudentOutcome()`.
- `OutcomeService`: sets, school and course outcomes, `importCsv()`, `courseOutcomes()`, `alignments()`, `align()`, `unalign()`.
- `outcome-evidence.ts`: `refreshOutcomeEvidence()`, `activitiesForAlignment()`, `copyOutcomeAlignments()`, `countsAsEvidence()`, `markBeforePenalty()`, `ratingRank()`.
- `mastery-report.ts`: `loadReportOutcomes()`.

## Data

[`prisma/schema/mastery.prisma`](../../prisma/schema/mastery.prisma), migration `20261126100000_mastery` (hand-written). Everything cascades with its school / course / activity / submission / student. `outcome_evidence.outcome_id` is `NO ACTION`, so an outcome with evidence cannot be deleted on its own (course and school deletes still remove both sides in one statement).

## Files

| File | Purpose |
| --- | --- |
| `mastery.module.ts` | Wiring |
| `mastery.controller.ts` | School, course and portal routes |
| `mastery.service.ts` | Scale and mastery views, CSV export |
| `outcome.service.ts` | Outcome sets, outcomes, CSV import, alignments |
| `outcome-evidence.ts` | Evidence refresh, alignment targets, course copy helper |
| `mastery.calc.ts` | Scale, levels, calculations, outcome CSV (pure) |
| `mastery-report.ts` | Report card outcomes section |
| `dto/mastery.dto.ts` | Request DTOs |

## Tests

```bash
cd backend && bun test src/mastery src/parent-portal/parent-mastery.test.ts
```

- `mastery.calc.test.ts`: score bands, rubric rank → scale, each calculation method (decaying-average maths, ordering by time), minimum evidence, level of a score, scale validation and stored-row fallbacks, outcome CSV (aliases, errors, loops, parents first).
- `outcome-evidence.test.ts`: raw mark before the late penalty, re-mark updates the same row, unchanged writes nothing, excusing removes, rubric rank and ratio, quiz question credit (skipping unmarked essays and questions not in the attempt), the rubric / teacher mark (and so LTI) / import paths refresh evidence, course-copy helper (remapping, nested outcomes, other school, no evidence copied).
- `mastery.service.test.ts`: alignment permissions (teacher, TA 403, outsider 404, outcome of another course or school 404, archived 400, one target, target in course, duplicate 409, unlink scoped), cross-school isolation for sets and outcomes, delete with evidence 409, CSV import, scale update, grid maths and scoping, formula-safe CSV, the `mastery` flag on every route (school, course, portal) and the `school:*` permissions.
- `mastery.audit.test.ts`: an audit entry (entity, action, id, school, before/after) for settings create/update, outcome set create/update/archive/delete, CSV import as one entry (new and existing set, none for a dry run), school and course outcome create/edit/archive/delete, alignment link/unlink; no entry for refused writes or evidence recomputation; writes still work without an audit log.
- `mastery-report.test.ts`: section off by setting or feature, labels and mastered per course, year-course cutoff, PDF text.
- `src/parent-portal/parent-mastery.test.ts`: both flags needed, another family's child 404, `showMastery` default off (403, nothing read), the student's own data only.
