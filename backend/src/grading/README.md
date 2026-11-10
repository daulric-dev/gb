# Grading (`src/grading`)

The work set in a course and the marks it produces. The module covers activities (quizzes, assignments and offline work), quiz questions, student submissions, assignment groups with weights and drop rules, rubrics, the course gradebook, and gradebook CSV export and import.

A mark lives in exactly one place: the student's **submission** for the activity (`grading.submission.score`). There is no separate grades table.

- Grading an assignment, auto-scoring a quiz, marking with a rubric and importing a CSV all write that one column.
- A rubric assessment only records how a mark was reached.
- The course total is computed when it is read, by the pure functions in `gradebook.calc.ts`. The teacher's grid, the student's grades page and the portal course cards therefore all show the same number.

Access is decided by the caller's **course role**, through `CourseAccessService`, not by catalog permissions:

- **`STAFF_ROLES`** (`admin`, `teacher`, `ta`) may read and mark.
- **`MANAGE_ROLES`** (`admin`, `teacher`) may build and change work, groups and rubrics.

A school member holding `course:update` counts as course `admin` everywhere. Students reach their side through the `/api/portal/me` routes, which live in `student-portal` and call this module's services.

## What it provides

### HTTP routes

Every route is behind `AuthGuard`. Ids in the path are checked with `ParseUUIDPipe`. "Staff" and "Manage" below mean the course roles above.

#### Activities and quiz questions (`activity.controller.ts`)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/courses/:courseId/activities` | Staff | Every activity in the course, drafts included. Soonest due first; undated work last. |
| POST | `/api/courses/:courseId/activities` | Manage | Create (`CreateActivityDto`). An assignment must accept a file, text or both. `allowMultipleFiles` is opt-in and only applies when `allowFile` is enabled. Offline work accepts nothing. `maxAttempts` 0 means unlimited (stored as null); the default is 1. |
| GET | `/api/activities/:activityId` | Staff | One activity, with its quiz questions and options, correct answers included |
| PATCH | `/api/activities/:activityId` | Manage | Update (`UpdateActivityDto`): title, instructions, points, due date, group (`null` means Ungrouped), `omitFromFinalGrade`, accepted inputs (including `allowMultipleFiles`), attempts, the late policy (`lateUntil`, `latePenaltyMode`, `latePenaltyValue`, `latePenaltyCap`) and, on a quiz, `shuffleQuestions` / `shuffleOptions` |
| POST | `/api/activities/:activityId/publish` | Manage | Set status `published`. A quiz needs at least one question. `published_at` keeps the first publish date when reopening. Fires `CourseNotificationService.activityPublished()` without waiting for it. |
| POST | `/api/activities/:activityId/close` | Manage | Set status `closed`. No more submissions, but the activity stays visible and can still be graded. |
| DELETE | `/api/activities/:activityId` | Manage | Delete. Refused (409) once any submission exists; close it or omit it from the final grade instead. |
| POST | `/api/activities/:activityId/questions` | Manage, draft quiz only | Add a question (`AddQuestionDto`) |
| PATCH | `/api/activities/:activityId/questions/:questionId` | Manage, draft quiz only | Edit a question. Options are replaced as a whole list (`UpdateQuestionDto`). |
| DELETE | `/api/activities/:activityId/questions/:questionId` | Manage, draft quiz only | Remove a question |

Questions are frozen once a quiz is published, because changing the answer key would silently rescore work already handed in. The rules per kind (`validateQuestion` in `quiz-questions.ts`; `AddQuestionDto` / `UpdateQuestionDto` carry the per-kind settings) and how each is scored (credit 0 to 1, times the question's points):

| Kind | Needs | Scored |
| --- | --- | --- |
| `multiple_choice`, `true_false` | At least two options, exactly one correct | The chosen option is correct |
| `short_answer` | At least one accepted wording (all correct) | Equal to a wording, ignoring case and surrounding spaces |
| `multiple_select` | At least two options, one or more correct; `scoring` | All or nothing (exactly the correct set), or `partial`: (right picks − wrong picks) / correct options, at least 0 |
| `numeric` | `numericAnswer`, `numericTolerance` (absolute, >= 0) | Within the tolerance, inclusive |
| `matching` | At least two options, each with a `matchLabel`; `scoring` | Every pair right, or `partial`: the share of pairs right |
| `ordering` | At least two options, in the right order; `scoring` | Every item in place, or `partial`: the share in place |
| `essay` | Optional course `rubricId` (a guide for the marker) | By the teacher (`manual_points / points`) |
| `file_upload` | Optional `fileTypes` (`.pdf`, `image/*`) and `fileMaxMb` | By the teacher |

An answered essay or file question with no mark leaves the submission `submitted` ("needs marking", `needsMarking` on the roster and the student's view); auto-scored parts are scored at once, and the score is final (`graded`) once every one is marked. The rules live in `grading.submit_quiz`, its TypeScript copy `QUIZ_CREDIT` / `rescoreSql` in `quiz-rescore.ts` (checked word for word against the latest migration by `quiz-rescore.test.ts`), and `questionCredit()` in `quiz-questions.ts` (the teacher's per-question view and unit tests).

**Exposure.** A student never receives the answer key: no `isCorrect`, no numeric answer, no short-answer wordings, and matching right-hand items as a separate alphabetical `matchChoices` list. Ordering items are never sent in the right order. Staff routes include the key.

#### Question banks and draws (`question-bank.controller.ts`, served by `QuestionBankService`)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/courses/:courseId/question-banks` | Staff | The course's banks with `questionCount` |
| POST | `/api/courses/:courseId/question-banks` | Manage | Create (`QuestionBankDto`: `title`). Audited. |
| GET | `/api/question-banks/:bankId` | Staff | One bank with its questions (answer key included) and `locked` per question |
| PATCH | `/api/question-banks/:bankId` | Manage | Rename |
| DELETE | `/api/question-banks/:bankId` | Manage | Delete (`204`); `409` once an attempt was given one of its questions or a published quiz draws from it |
| POST / PATCH / DELETE | `/api/question-banks/:bankId/questions[/:questionId]` | Manage | Add, edit, remove a bank question (same DTOs and rules as a quiz's). A question an attempt has been given is frozen (`409`). |
| PUT | `/api/activities/:activityId/bank-draws` | Manage, draft quiz only | Replace the quiz's draws (`SetBankDrawsDto`: `[{ bankId, count }]`, at most 20, each bank once, in the course, `count` at most the bank's size) |

A quiz needs a question or a draw to publish. `GET /api/activities/:activityId` also returns `bankDraws`.

**Attempts.** Starting an attempt (`startQuizAttempt`) fixes its questions in `grading.quiz_attempt_question`: the quiz's own, then `count` random questions from each draw (never one twice), the whole list shuffled with `shuffleQuestions`, and options shuffled with `shuffleOptions` (multiple choice, multiple select, matching; true/false never; ordering always, never left in the right order). It is built by `buildAttemptPlan(seed, …)` from a random seed and stored, so resuming shows the same quiz and scoring and later re-scoring use exactly those questions. A retake clears the answers and plans again. Attempts from before this have no rows and use the quiz's own questions.

#### Marking (`activity.controller.ts`, served by `SubmissionService`)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/activities/:activityId/submissions` | Staff | The active and completed roster, plus anyone else with a submission, each with their submission or `null` |
| PATCH | `/api/activities/:activityId/submissions/:studentId/grade` | Staff | Mark one student (`GradeSubmissionDto`: 0 to the activity's points, at most two decimals). Creates the submission if there is none, which is how offline work and non-submitters get marks. The activity must not be a draft. |
| POST | `/api/activities/submissions/:submissionId/grade` | Staff | The same, addressed by submission id |
| PATCH | `/api/activities/:activityId/submissions/:studentId/excuse` | Staff | Excuse or un-excuse (`ExcuseSubmissionDto`). Any mark is kept. A student with no submission gets a `graded` row with no score. |
| PATCH | `/api/activities/:activityId/submissions/:studentId/late-penalty` | Staff | Waive or restore the late penalty (`WaiveLatePenaltyDto`: `waived`). The score goes back to the raw mark, or the penalty applies again. Audited. `404` with no submission. |
| GET | `/api/activities/:activityId/submissions/:studentId/answers` | Staff | One student's quiz, question by question: the attempt's questions with the key, the answer (and file), `earned`, `needsMarking` and the teacher's `mark` |
| PUT | `/api/activities/:activityId/submissions/:studentId/questions/:questionId/mark` | Staff | Mark an essay or file question (`MarkQuestionDto`: `points` 0 to the question's, `feedback`). Rescores the quiz from its answers (`rescoreQuizFromAnswers(…, submissionId)`), which becomes `graded` once nothing is unmarked, applies the late policy, audited as `quiz_answer`. Refused while the attempt runs or when a whole-quiz mark was entered by hand. |
| GET | `/api/activities/submissions/:submissionId/file` | Staff | The file a student handed in, served inline |

Each roster row also carries `effectiveDueAt` (the student's extension, else the activity's due date), `closesAt` (see late work below), on the submission `rawScore`, `lateSeconds`, `latePenaltyPercent`, `latePenaltyWaived` and (quizzes) `needsMarking`, and `extension` (`{ dueAt, reason, createdBy, createdAt, updatedAt }` or `null`). On a quiz it carries `accommodation` (the effective one: `{ source: 'activity' | 'student', timeMultiplier, extraMinutes, lockdownExempt }` or `null`) and `defaultAccommodation` (the student's school-wide default on its own, which applies again if the quiz's own is removed). A Lockdown-exempt student is never reported away.

#### Due date extensions (`extension.controller.ts`, served by `ExtensionService`)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/activities/:activityId/extensions` | Staff | Every extension on the activity |
| PUT | `/api/activities/:activityId/extensions/:studentId` | Staff | Set or replace one student's due date (`SetExtensionDto`: `dueAt` in the future, optional `reason` up to 500). The student must be enrolled (not dropped); offline work is refused. Audited as `activity_extension`. |
| DELETE | `/api/activities/:activityId/extensions/:studentId` | Staff | Remove the extension (`204`); `404` when there is none. Audited. |

Due dates are enforced on the student routes (`due-date.ts`): after the student's close date (their extension, else the activity's late-until, else its due date; see *Late work* below), starting a quiz, saving quiz answers, handing in, upload tickets and attaching uploads are a `409` ("This was due on … UTC. Ask your teacher for an extension"). A quiz attempt started in time runs to its own `quiz_expires_at`; an untimed attempt is stamped to expire at the due date, so the expiry sweep submits it then, and moving the due date (an extension set or removed, the activity's date edited) moves running untimed attempts with it. Marking, excusing, import and offline work ignore due dates. Portal activity responses carry `effectiveDueAt`, `hasExtension`, `lateUntil`, `isLate` and `isClosed`.

#### Late work (`late-policy.ts`, `lateness.ts`)

An activity can accept work after its due date until `late_until`, with a penalty (`late_penalty_mode` `none` / `percent_per_day` / `percent_per_hour`, `late_penalty_value` percent per unit, optional `late_penalty_cap`). Checked by `latePolicyColumns()`: late-until needs a due date before it; a penalty needs a late-until; offline work has none.

- **Dates.** A student's due date is their extension, else the activity's. Work closes to them (`effectiveCloseAt`) at their extension when they have one (it wins entirely: no late window, no penalty before it), else at `late_until`, else at the due date. Every enforcement point above uses the close date; past it the 409 reads "Late work closed on … UTC" when there was a late window. Portal responses add `lateUntil` (null with an extension), `isLate` and the policy fields. An untimed quiz attempt started on time still ends at the due date; started late, at the close.
- **Lateness** is stored on the submission (`late_seconds`): whole seconds from the effective due date to the hand-in (`submitted_at`), or for a quiz to when its attempt started (`attempt_started_at`), so a timed attempt begun in time is never late.
- **Penalty** (`latePenaltyPercent`): every started day or hour counts in full (one minute late = one day), times the value, capped, never above 100. It is a percentage of the mark: `score = raw_score × (100 − percent) / 100` (85 with 10% is 76.5).
- **Where it is applied.** `refreshLateness(tx, activityId, studentIds?)` recomputes lateness, the percent and `score` from `raw_score` in the caller's transaction after every hand-in, teacher mark, rubric mark, quiz submit (`submit_quiz` writes `raw_score` = `score`, then the API applies the penalty), question mark, waiver, extension change, and change of the activity's dates, policy or points. `score` is therefore always the final mark, and the gradebook, CSV export, report cards (`report-data.service.ts` reads `score`), portals and webhooks agree. An imported mark is taken as final (`raw_score` null), as are marks from before this.

#### Quiz accommodations (`accommodation.controller.ts`, served by `AccommodationService`)

A student can have more time on timed quizzes (a multiplier of ×1.25, ×1.5 or ×2, **or** 1 to 600 extra minutes) and/or be **exempt from Lockdown**. A school-wide default per student (`grading.student_accommodation`) applies to every quiz; an accommodation on one quiz (`grading.activity_accommodation`) replaces the default entirely on that quiz. An accommodation must change something (time or Lockdown).

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/activities/:activityId/accommodations` | Staff | Every accommodation on the activity (with `reason`) |
| PUT | `/api/activities/:activityId/accommodations/:studentId` | Staff | Set or replace one student's accommodation (`SetAccommodationDto`). Quizzes only; the student must be enrolled (not dropped). Audited as `activity_accommodation`. |
| DELETE | `/api/activities/:activityId/accommodations/:studentId` | Staff | Remove it (`204`); the default, if any, applies again. `404` when there is none. Audited. |
| GET | `/api/students/:studentId/accommodation` | `student:read` | The student's school-wide default, or an empty body when there is none |
| PUT | `/api/students/:studentId/accommodation` | `student:update` | Set or replace the default (`SetAccommodationDto`). Audited as `student_accommodation`. |
| DELETE | `/api/students/:studentId/accommodation` | `student:update` | Remove the default (`204`). Audited. |

"Staff" is the same check as extensions (teacher, TA or course admin in the activity's course). The `/students` routes are scoped to the caller's school; a student elsewhere is a `404`.

How it applies (`accommodation.ts`):

- **Start.** A timed attempt's `quiz_expires_at` is the start plus the accommodated limit: `ceil(limit × multiplier)` or `limit + extra minutes`. A ×1.5 student gets 45 minutes on a 30-minute quiz. As before, a timed attempt runs its full (accommodated) time even past the due date.
- **Untimed quizzes.** Extra time does not apply: an untimed attempt still ends at the student's effective due date. Only an extension moves that.
- **Changes mid-attempt.** Setting or changing an accommodation re-stamps the student's running timed attempts to `started + new limit`, but only ever later: a running attempt never loses time, so a reduction or removal applies from the next attempt. Resuming returns the stamped expiry; the expiry sweep and the submit-on-read path use it unchanged.
- **Lockdown exemption.** The presence endpoint is a no-op for the student, the roster never marks them away, and their activity responses (`GET /api/portal/me/activities/:id`, the course list) report `lockdownBrowser: false`, so web and mobile skip the rules card, fullscreen and pinning.
- **What the student sees.** Their own `timeLimitMinutes` (already accommodated) and `standardTimeLimitMinutes` (the quiz's). Never the reason, the source, or anyone else's accommodation.

#### Assignment groups (`assignment-group.controller.ts`)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/courses/:courseId/assignment-groups` | Staff | Groups in display order |
| POST | `/api/courses/:courseId/assignment-groups` | Manage | Create (`CreateAssignmentGroupDto`: name, weight 0 to 100 or null, `dropLowest` and `dropHighest` 0 to 50). The new group goes at the end. A duplicate name is a 409. |
| PATCH | `/api/courses/:courseId/assignment-groups/reorder` | Manage | Set the order (`ReorderAssignmentGroupsDto`). Groups the client leaves out keep their place after the ones it sent. |
| PATCH | `/api/courses/:courseId/assignment-groups/:groupId` | Manage | Update (`UpdateAssignmentGroupDto`) |
| DELETE | `/api/courses/:courseId/assignment-groups/:groupId` | Manage | Delete. Its activities move to Ungrouped (the foreign key sets them to null). |

#### Rubrics (`rubric.controller.ts`)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/courses/:courseId/rubrics` | Staff | The course's rubrics, each flagged `assessed` once it has marked anyone |
| POST | `/api/courses/:courseId/rubrics` | Manage | Create (`CreateRubricDto`). Every level must fit within its criterion's points. |
| GET | `/api/courses/:courseId/rubrics/:rubricId` | Staff | One rubric |
| PATCH | `/api/courses/:courseId/rubrics/:rubricId` | Manage | Rename, or replace the criteria. Changing criteria is refused once the rubric has assessed anyone; copy it instead. |
| POST | `/api/courses/:courseId/rubrics/:rubricId/copy` | Manage | A fresh, unassessed copy |
| DELETE | `/api/courses/:courseId/rubrics/:rubricId` | Manage | Delete. Activities using it are detached and its criterion marks are removed, but the scores they produced stay on the submissions. |
| GET | `/api/activities/:activityId/rubric` | Staff | The activity's rubric, and every student's criterion marks keyed by student |
| PUT | `/api/activities/:activityId/rubric` | Manage | Attach a course rubric, or detach with `null` (`AttachRubricDto`). Quizzes cannot have a rubric. |
| PUT | `/api/activities/:activityId/submissions/:studentId/rubric` | Staff | Mark with the rubric (`AssessRubricDto`). Each criterion gets a level (its points by default) or bare points. The score is the sum unless `score` overrides it, and it must be between 0 and the activity's points. The submission and its criterion marks are written in one transaction, replacing any earlier rubric marking. |

#### Gradebook (`gradebook.controller.ts`)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/courses/:courseId/gradebook` | Staff | `{ groups, activities, students }`. One row per active or completed student, with a cell per activity (score, status, excused, submitted at, dropped) and their `grade` (see below). Sorted by last name, then first name. |
| GET | `/api/courses/:courseId/gradebook/export` | Staff | CSV download (`<course code or name>-grades.csv`), described below |
| POST | `/api/courses/:courseId/gradebook/import/preview` | Staff | Plan an import from a CSV (`ImportGradebookDto`). Nothing is written. |
| POST | `/api/courses/:courseId/gradebook/import` | Staff | Plan again from the same CSV and current marks, then write every change in one transaction. Any error in the file refuses the whole import (400 with `errors`). Returns `{ applied, unchanged }`. |

### Services / exports

`GradingModule` imports `FileManagerModule` and exports `SubmissionService` and `GradebookService`. Course access (`CourseAccessModule`) and course notifications (`CourseNotificationModule`) are global modules.

**`ActivityService`**

- `listForCourse()`, `get()`, `create()`, `update()`, `publish()`, `close()`, `remove()`.
- `addQuestion()`, `updateQuestion()`, `removeQuestion()`.

**`SubmissionService`**, student side (called from the portal):

- `listForStudent(studentId)`: the to-do list across visible courses.
- `listCourseForStudent()`.
- `getForStudent()`: questions without the answers.
- `createUploadTicket()`, `finaliseUploadedFile()`: the student PUTs the file straight to storage with a presigned ticket (no route takes file bytes through the API); it is uploaded as the student's own login through `FileManagerService`, because students hold no `file:*` permissions. The size limit is the course's school's upload limit (`UploadLimitService`).
- `submitAssignment()`: a client-supplied `fileId` must be the student's own `ready` file.
- `submitQuiz()`: stores answers (only answers to this quiz's questions, and only options belonging to each question), then calls the database function `grading.submit_quiz`.
  - The function locks the row, enforces `max_attempts`, scores the quiz, scales the score to the activity's points and marks it `graded`.
  - Changing a quiz's points (`PATCH /api/activities/:id`) keeps automatic scores (`graded_by` null) in step in the same transaction: rescaled by new/old points, or - from 0 points, where every score was 0 - scored again from the stored answers by the same rules (`rescoreQuizFromAnswers` in `quiz-rescore.ts`, whose test checks it against the latest `submit_quiz`). A submission with a retake in progress is skipped (starting a retake clears its answers); teacher marks are never changed and must fit the new points.
  - A retake clears the previous answers first.

**`SubmissionService`**, staff side: `listForTeacher()`, `grade()`, `gradeSubmission()`, `excuse()`, `readSubmissionFile()`.

**`SubmissionService`**, quizzes: `startQuizAttempt()` (plans the attempt), `saveQuizAnswers()` / `submitQuiz()` (answers per kind via `answerRow()`; a file answer must be the student's own ready upload), `createQuizUploadTicket()` / `finaliseQuizUpload()` (files for a file question, checked against its types and size; `POST /api/portal/me/activities/:id/quiz/questions/:questionId/upload-ticket[/:fileId/complete]`), `quizAnswers()`, `markQuestion()`, `waiveLatePenalty()`.

**`QuestionBankService`**: `list()`, `create()`, `get()`, `rename()`, `remove()`, `addQuestion()`, `updateQuestion()`, `removeQuestion()`, `setDraws()`.

**`AccommodationService`**: `listForActivity()`, `setForActivity()`, `removeForActivity()`, `getForStudent()`, `setForStudent()`, `removeForStudent()`. Module-level helpers: `loadAccommodation(prisma, studentId, activityId)` (used by `SubmissionService`) and `restampRunningQuizAttempts()`.

**`AssignmentGroupService`**: `loadForCourse()` (also used by the gradebook), `list()`, `create()`, `update()`, `reorder()`, `remove()`.

**`RubricService`**: `list()`, `get()`, `create()`, `update()`, `copy()`, `remove()`, `attach()`, `forActivity()`, `assess()`. The module-level helpers `loadRubric()` and `loadAssessments()` are exported for the portal's work view, which reads a rubric without the staff checks. `SubmissionService.getForStudent()` uses them.

**`GradebookService`**

- `gradebook(userId, courseId)` and `exportCsv(userId, courseId)`.
- `studentSummary(courseId, studentId)`: one student's `CourseGrade`, for the portal course cards. It does no access check, so the caller must decide first.
- `studentGrades(studentId, courseId)`: the student's grades page. It checks `requireStudent`, and lists each activity with the student's submission state and whether it was dropped.
- Also exported: `csvCell(value)`, which quotes a CSV cell and defuses formula injection.

**`GradebookImportService`**: `preview(userId, courseId, csv)` and `apply(userId, courseId, csv)`.

### Other (pure helpers other code imports)

- **`gradebook.calc.ts`**:
  - `counts()`, `isWeighted()`, `calculateCourseGrade()`.
  - `applyDrops()`, `bestSubset()`, `ratioSearchSubset()`.
  - `letterFor()`, `UNGROUPED_NAME`.
- **`gradebook-import.ts`**: `parseCsv()` (RFC 4180, BOM, CRLF or LF), `activityHeader()`, `planImport()`.
- **`activity.mapper.ts`**:
  - Wire shapes: `toActivity()`, `toPortalActivity()`, `toPortalSubmission()`. A score and feedback reach a student only once the work is graded.
  - Query fragments: `ACTIVITY_SELECT`, `ACTIVITY_ORDER`.
  - Dates: `toTimestamp()` (a date without an offset is read as UTC) and `ts()`.
- **`accommodation.ts`**: `effectiveAccommodation()` (the activity's row, else the default), `accommodatedTimeLimit()`, `lockdownFor()`, `accommodationColumns()` (validation), `TIME_MULTIPLIERS`.
- **`round.ts`**: `roundScore()` (two decimals) and `scoreOrNull()`. Stored values keep full precision. Totals are computed from the unrounded values and rounded once at the end.

## How the course grade is calculated

`calculateCourseGrade(groups, activities, submissions)` in `gradebook.calc.ts` follows Canvas's "current grade": only marked work counts, so a student's total is what they have earned so far, not what they would have if every missing piece scored zero.

1. **What counts.** A mark counts only when all of these hold:
   - the activity is `published` or `closed`,
   - it is not `omitFromFinalGrade`,
   - the submission is `graded`, is not excused, and has a score.

   An excused mark is left out entirely: both its score and its points. Ungraded or missing work is ignored rather than counted as zero.
2. **Buckets.** Each counted mark goes into its assignment group. Work with no group, or whose group is not in this course, goes into **Ungrouped**. Ungrouped is only listed when some published work is in it.
3. **Drop rules**, per student and per group, among the marks that count:
   - `dropLowest` N first, then `dropHighest` M from what is left.
   - "Lowest" means the marks whose removal leaves the *best* group percentage, not simply the smallest percentages. With unequal points, dropping a 0/1 can matter less than dropping a 40/100. So the kept set is the subset of the right size with the best earned/possible ratio. "Highest" is the same search for the worst ratio.
   - The search is exhaustive while there are at most 5000 combinations. Past that it uses Dinkelbach's method (`ratioSearchSubset`), which is also exact.
   - A rule never empties a group: at least one mark is always kept. Ties keep the earlier activities.
   - Ungrouped has no drop rules.
   - Dropped activity ids are returned per group, and the gradebook marks those cells `dropped`.
4. **Group totals.** Each group reports earned, possible and percent. Percent is null when nothing in it counts.
5. **Course percent.**
   - **Weighted** as soon as any group has a weight above 0. The total is `Σ(weight × group%) / Σ(weight)` over only the groups that have marked work. Weights therefore need not add up to 100, and a term with no exam marked yet is not dragged down by the exam's empty share. In a weighted course, a group with no weight and Ungrouped both count for nothing.
   - **Unweighted** (all weights blank or 0): total earned over total possible across all buckets.
   - Null when nothing counts.
6. **Letter.** `letterFor(bands, percent)` takes the course's grade scale (`course.grade_scale_id`), or else the school's default scale. It picks the band with the highest `minPercentage` that is at or below the percent. Matching on the lower bound means 89.5 still gets a B on a scale typed as "B 80-89". The letter is null with no scale.

The result is the `CourseGrade` contract: `{ percent, letter, groups[{ groupId, name, weight, earned, possible, percent, dropped }], dropped }`.

## CSV export and import

**Export** columns are:

1. `Last name`, `First name`, `Student ID`, `Status`.
2. One column per published or closed activity, headed `Title (points)`. A cell holds the score, `EX` for excused, or is blank.
3. One `<group> %` column per group, plus `Ungrouped %` when used.
4. `Total %` and `Letter`.

Rows are CRLF-terminated. `csvCell()` prefixes cells that start with `= + - @ tab CR` with `'` (unless they are plain numbers) so a spreadsheet will not run them as formulas.

**Import** (`planImport`) takes the same sheet:

- **Students** are matched by `Student ID` when the column is present, otherwise by email, otherwise by first and last name. Each match must pick out exactly one student on the active or completed roster.
- **Columns** match the `Title (points)` header, or a bare title that names exactly one activity. Status, group %, Total % and Letter columns are ignored.
- **Cells**:
  - A blank cell is skipped.
  - A number from 0 to the activity's points, with at most two decimals, sets the score and lifts any excuse.
  - `EX` excuses the student and keeps the score.
  - A cell equal to the current mark (compared at two decimals) is not a change, so re-importing an untouched export changes nothing.
- **Quizzes** are treated like any other column.
- **Apply** writes `graded` submissions, upserting on `(activity_id, student_id)`. It never touches feedback or the student's own text or file.

## Used by

- `src/student-portal/student-portal.module.ts` imports `GradingModule`.
  - `portal-activity.controller.ts` (routes under `/api/portal/me`) uses:
    - `SubmissionService.listForStudent()`, `listCourseForStudent()` and `getForStudent()`,
    - `createUploadTicket()`, `finaliseUploadedFile()`, `submitAssignment()` and `submitQuiz()`,
    - `GradebookService.studentGrades()`.
  - It also uses `SubmitAssignmentDto` and `SubmitQuizDto` from `dto/activity.dto.ts`.
  - `student-portal.service.ts` calls `GradebookService.studentSummary()` for each portal course card.
- `src/attendance/attendance.service.ts` imports `csvCell` for its own CSV export.
- `src/report-card` imports `calculateCourseGrade()`, `letterFor()` and the `Calc*` types from `gradebook.calc.ts` (a term's final grade per course), `scoreOrNull()` from `round.ts` and `contentDisposition()`.
- `src/calendar/calendar.service.ts` imports `roundScore`.
- `src/app.module.ts` imports `GradingModule`.
- Front end:
  - `frontend/app/dashboard/courses/[courseId]/assignments/` (the page, `[activityId]/page.tsx`, `CreateActivityDialog.tsx`, `QuestionCard.tsx`, `MarksTable.tsx`, `AssignmentGroupsDialog.tsx`, `RubricPanel.tsx`, `RubricEditorDialog.tsx`, `RubricMarkDialog.tsx`).
  - `frontend/app/dashboard/courses/[courseId]/grades/page.tsx` (gradebook and export) and `grades/_components/ImportGradesDialog.tsx` (import preview and apply).
  - Wire types are in `frontend/lib/courses/types.ts`.
- Mobile:
  - `mobile/app/teaching/[courseId]/activity/[activityId].tsx`.
  - `mobile/app/teaching/[courseId]/mark/[activityId]/[studentId].tsx`.
  - `mobile/src/features/course/StaffSections.tsx`.
  - On the student side: `mobile/app/work/[activityId].tsx` and `mobile/src/lib/work.ts`, through the portal routes.

## Depends on

- `PrismaService`.
- `CourseAccessService`, plus the `STAFF_ROLES` and `MANAGE_ROLES` constants, from `src/course/access`.
- `FileManagerService` (`src/file-manager`): hand-in uploads and reading submission files.
- `CourseNotificationService` (`src/course-notification`), injected as optional: the "activity published" notice and push.
- `pgCode()`, `raisedMessage()` and `isUniqueViolation()` from `src/common/db-values.ts`.
- The Postgres function `grading.submit_quiz(submission_id, student_id)`, last defined in `prisma/migrations/20261117100000_quiz_question_types/migration.sql`.

## Data

See [`prisma/schema/grading.prisma`](../../prisma/schema/grading.prisma) and [`prisma/schema/course.prisma`](../../prisma/schema/course.prisma).

| Table | Read or written for |
| --- | --- |
| `grading.activity` | Activities: kind, points, due date, status, inputs, `max_attempts`, `omit_from_final_grade`, `rubric_id` |
| `grading.quiz_question`, `grading.quiz_option` | Quiz and bank content, per-kind settings and answer key |
| `grading.quiz_answer` | A student's answers for the current attempt (per kind), and the teacher's marks on essay and file answers |
| `grading.question_bank`, `grading.quiz_bank_draw` | Banks per course; how many questions a quiz draws from each |
| `grading.quiz_attempt_question` | The questions, order and option order an attempt was given |
| `grading.submission` | Work and the mark: `status`, `score`, `feedback`, `excused`, `excused_reason`, `text_body`, `file_id`, `attempt_count`, `graded_by`, `graded_at`. Unique on `(activity_id, student_id)`. |
| `grading.activity_extension` | One later due date per `(activity_id, student_id)`, with `reason` and `created_by` |
| `grading.activity_accommodation` | One quiz accommodation per `(activity_id, student_id)`: `time_multiplier` (1.25, 1.5, 2) or `extra_minutes` (1-600), `lockdown_exempt`, `reason`, `created_by` |
| `grading.student_accommodation` | One school-wide default per student (the student row is school-scoped), same columns |
| `grading.rubric`, `rubric_criterion`, `rubric_rating`, `rubric_assessment` | Rubrics and per-criterion marks |
| `grading.grade_scale`, `grade_scale_band` | Read for letters |
| `course.assignment_group` | Groups, weights, positions, `drop_lowest` and `drop_highest` |
| `course.course`, `course.course_student` | Course scale and school; the roster |
| `student.student` | Names; email through `user_profile` for import matching |
| `file_manager.file` | Checking a handed-in file belongs to the student |

## Configuration

None.

## Files

| File | Purpose |
| --- | --- |
| `grading.module.ts` | Module wiring; exports `SubmissionService` and `GradebookService` |
| `activity.controller.ts` | Activity, question and marking routes |
| `activity.service.ts` | Activities and quiz questions |
| `activity.mapper.ts` | Row-to-wire mapping, select and order fragments, timestamp helpers |
| `submission.service.ts` | Student hand-ins and quizzes, staff marking and excusing |
| `assignment-group.controller.ts` | Assignment group routes |
| `assignment-group.service.ts` | Assignment groups |
| `rubric.controller.ts` | Rubric routes |
| `rubric.service.ts` | Rubrics, attaching, rubric marking; `loadRubric()` and `loadAssessments()` |
| `gradebook.controller.ts` | Gradebook, export and import routes |
| `gradebook.service.ts` | Gradebook grid, CSV export, student summaries; `csvCell()` |
| `gradebook.calc.ts` | The course-grade calculation (pure) |
| `gradebook-import.ts` | CSV parsing and import planning (pure) |
| `gradebook-import.service.ts` | Import preview and transactional apply |
| `round.ts` | Two-decimal rounding |
| `late-policy.ts` | Late policy: lateness, penalty percent, validation, wire fields (pure) |
| `lateness.ts` | `refreshLateness()`: lateness and penalised scores in a transaction |
| `quiz-questions.ts` | Question kinds: validation, scoring mirror, attempt plan, student shape, answers (pure) |
| `quiz-rescore.ts` | `QUIZ_CREDIT` and `rescoreQuizFromAnswers()`: the TypeScript copy of `submit_quiz`'s scoring |
| `question-write.ts` | Creating, editing and reading questions (quiz and bank) |
| `question-bank.controller.ts`, `question-bank.service.ts` | Question banks and quiz draws |
| `due-date.ts` | Effective due dates, past-due checks and the quiz attempt grace (pure) |
| `extension.controller.ts`, `extension.service.ts` | Per-student due date extensions |
| `accommodation.ts` | Effective accommodation and accommodated time limit (pure) |
| `accommodation.controller.ts`, `accommodation.service.ts` | Per-student quiz accommodations, on one quiz and the school-wide default |
| `activity.service.test.ts` | Activity tests |
| `submission.service.test.ts` | Submission tests |
| `rubric.service.test.ts` | Rubric tests |
| `gradebook.service.test.ts` | Gradebook and assignment group tests |
| `gradebook.calc.test.ts` | Calculation tests |
| `gradebook-import.test.ts` | Import tests |
| `dto/` | Request DTOs, see [`dto/README.md`](dto/README.md) |

## Tests

`cd backend && bun test src/grading`.

- **`gradebook.calc.test.ts`** (the largest): `counts()`, `isWeighted()`, weighted and unweighted totals, what is left out (drafts, omitted, excused, ungraded), drop rules including unequal points and the large-input search, and `letterFor()`.
- **`gradebook.service.test.ts`**: the grid, CSV export, `studentSummary()`, `studentGrades()`, `AssignmentGroupService`, and drop rules end to end.
- **`gradebook-import.test.ts`**: `parseCsv()` and `planImport()` matching and changes.
- **`activity.service.test.ts`**: create, update and publish validation, and role checks.
- **`submission.service.test.ts`**: file handling, student access to activities, and marking.
- **`accommodation.test.ts`**, **`accommodation.service.test.ts`**, **`submission.accommodation.test.ts`**: effective time (multiplier, extra minutes, override vs default, none), validation, permissions and audit, quiz start expiry, untimed attempts and the due date, Lockdown exemption in presence, the roster and the student's view.
- **`rubric.service.test.ts`**: create and update rules, attach, assess and `forActivity()`.
- **`late-policy.test.ts`**: lateness, day vs hour rounding, the cap, validation, close dates and extension precedence, untimed attempts in the late window, `refreshLateness()` (penalty, extension removes it, waiver, quiz measured from the start, imported marks). **`submission.due-date.test.ts`** adds hand-ins in and after the late window and the audited waiver; **`gradebook.service.test.ts`** checks the grid, CSV and student summary use the same penalised mark.
- **`quiz-questions.test.ts`**: validation and scoring per kind (tolerance edges, partial credit, all or nothing), attempt plans (deterministic per seed, distinct draws, ordering never in order), what a student is sent, answer shapes. **`quiz-rescore.test.ts`**: the TypeScript copy matches the latest `submit_quiz`. **`submission.quiz-types.test.ts`**: attempts stored at start and kept on resume, the student's view, needs-marking and question marking, banks (permissions, frozen questions, draws).

## See also

- [`docs/content/backend/grading.md`](../../../docs/content/backend/grading.md): data model and contracts
- [`../grade-scale/README.md`](../grade-scale/README.md): the scales that letters come from
- [`../file-manager/README.md`](../file-manager/README.md): how hand-in files are stored
