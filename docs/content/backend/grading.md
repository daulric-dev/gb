---
sidebar_label: Grading
---

# Grading Module

`backend/src/grading/` - the work set in a course and the marks it produces: activities (quizzes, assignments, offline work), quiz questions, submissions, assignment groups, rubrics, the gradebook and its CSV import.

A mark lives in exactly one place: the student's **submission** for the activity (`grading.submission.score`). There is no separate grades table. Rubric assessments record *how* a mark was reached; the total they produce is written to the submission like any other mark.

## Files

| File | Purpose |
| --- | --- |
| `activity.controller.ts` / `activity.service.ts` | Activities and quiz questions; teacher marking |
| `activity.mapper.ts` | Row → wire shapes (`Activity`, portal activity, portal submission) |
| `submission.service.ts` | Student hand-ins (text, files via presigned upload, quizzes), marking, excusing |
| `assignment-group.controller.ts` / `.service.ts` | Weighted groups per course, with drop rules |
| `rubric.controller.ts` / `rubric.service.ts` | Course rubrics, attaching one to an activity, marking with it |
| `gradebook.controller.ts` / `gradebook.service.ts` | Course gradebook and CSV export; `studentSummary()` for the portal |
| `gradebook-import.ts` / `gradebook-import.service.ts` | CSV import: parsing and matching as pure functions; preview and transactional apply |
| `gradebook.calc.ts` | The grade calculation (including drop rules), as pure functions |
| `round.ts` | Two-decimal rounding for every score, total and percentage returned |

## Data model

| Table | Notes |
| --- | --- |
| `grading.activity` | `course_id`, `assignment_group_id`, `kind` (`quiz` \| `assignment` \| `offline`), `title`, `instructions` (Markdown), `points`, `due_at`, `status` (`draft` \| `published` \| `closed`), `allow_file`/`allow_text`, `max_attempts` (null = unlimited), `omit_from_final_grade`, `rubric_id` (null; set null if the rubric is deleted) |
| `grading.quiz_question` / `quiz_option` | `multiple_choice`, `true_false`, `short_answer` (options are the accepted wordings) |
| `grading.submission` | One row per (activity, student): `status` (`draft` \| `submitted` \| `graded`), `text_body`, `file_id`, `score`, `feedback`, `excused`, `excused_reason`, `attempt_count` |
| `grading.quiz_answer` | One row per (submission, question) |
| `grading.grade_scale` / `grade_scale_band` | Percentage → letter, per school (see the grade-scale module) |
| `course.assignment_group` | `name`, `weight` (0-100 or null), `position`, `drop_lowest` / `drop_highest` (0-50, default 0) |
| `grading.rubric` | A course's reusable rubric: `course_id`, `title`, `created_by` |
| `grading.rubric_criterion` | `rubric_id`, `title`, `description`, `points`, `position`; the rubric is worth the sum of its criteria |
| `grading.rubric_rating` | A level of a criterion: `criterion_id`, `label`, `description`, `points` (0..criterion points), `position` |
| `grading.rubric_assessment` | One row per (submission, criterion): `rating_id` (null for bare points; set null if the level is deleted), `points`, `comment` |

Quizzes are scored by the SQL function `grading.submit_quiz(submission, student)` under a row lock: it checks attempts, scores against the options of *each answer's own question*, and writes the score onto the submission.

## Access

Every route resolves the activity's course through `CourseAccessService`:

- **Read, mark, excuse, mark with a rubric, import marks from CSV**: course staff (admin, teacher, TA).
- **Create, edit, publish, close, delete, questions, rubrics (build, attach, copy, delete), group weights and drop rules**: admin or teacher.
- **Students** reach their own work through `/portal/me/activities/...` (`StudentGuard`), only for published or closed activities in a published course they are actively enrolled in. Answer keys are never sent to students.

## Rules

- Questions are editable only while the quiz is a **draft**; publishing freezes them.
- An activity with submissions cannot be deleted; close it instead.
- Offline activities accept no hand-ins; staff enter marks directly.
- Marks are 0..points with at most two decimals. Grading a student with no submission creates one as `graded`.
- Hand-ins are refused once the course is archived.
- Rubrics attach to assignments and offline work, never quizzes, and only from the activity's own course. Once a rubric has marked anyone its criteria are **frozen** (409): rename it, or **copy** it and change the copy. Deleting a rubric detaches it everywhere and deletes its criterion marks; the scores they produced stay on the submissions.
- Marking with a rubric: each criterion gets a level (its points) or bare points (0..criterion points, two decimals), with an optional comment. The score is their sum unless the request gives `score`, which overrides it; either way it must be 0..activity points, so a rubric worth more than the activity needs an override. The submission and its criterion marks are written in one transaction, replacing any earlier rubric marking. A plain `PATCH .../grade` afterwards changes the score and leaves the criterion marks as they were.
- Students see the attached rubric on their work page (`rubric`), and their levels and comments (`rubricAssessment`) once the work is graded with it.

## Endpoints

```
GET    /api/courses/:courseId/activities                         Activity[]
POST   /api/courses/:courseId/activities                         {kind, title, instructions?, points, dueAt?, assignmentGroupId?, allowFile?, allowText?, maxAttempts?}
GET    /api/activities/:activityId                               Activity & { questions }
PATCH  /api/activities/:activityId                               (title, instructions, points, dueAt, assignmentGroupId, omitFromFinalGrade, ...)
POST   /api/activities/:activityId/publish | /close
DELETE /api/activities/:activityId
POST   /api/activities/:activityId/questions                     {prompt, kind, points?, options}
PATCH  /api/activities/:activityId/questions/:questionId
DELETE /api/activities/:activityId/questions/:questionId
GET    /api/activities/:activityId/submissions                   every course student, with their submission or null
PATCH  /api/activities/:activityId/submissions/:studentId/grade  {score, feedback?}
PATCH  /api/activities/:activityId/submissions/:studentId/excuse {excused, reason?}
POST   /api/activities/submissions/:submissionId/grade           (same, by submission id)
GET    /api/activities/submissions/:submissionId/file            the handed-in file

GET    /api/courses/:courseId/assignment-groups
POST   /api/courses/:courseId/assignment-groups                  {name, weight?, dropLowest?, dropHighest?}
PATCH  /api/courses/:courseId/assignment-groups/reorder          {groupIds}
PATCH  /api/courses/:courseId/assignment-groups/:groupId         {name?, weight?, dropLowest?, dropHighest?}
DELETE /api/courses/:courseId/assignment-groups/:groupId         activities fall back to ungrouped

GET    /api/courses/:courseId/rubrics                            Rubric[]  (staff)
POST   /api/courses/:courseId/rubrics                            {title, criteria: [{title, description?, points, ratings: [{label, description?, points}]}]}
GET    /api/courses/:courseId/rubrics/:rubricId                  Rubric
PATCH  /api/courses/:courseId/rubrics/:rubricId                  {title?, criteria?}  criteria replace the old ones; 409 once assessed
POST   /api/courses/:courseId/rubrics/:rubricId/copy             a fresh, unassessed copy
DELETE /api/courses/:courseId/rubrics/:rubricId                  204
GET    /api/activities/:activityId/rubric                        {rubric, assessments: {[studentId]: RubricAssessment[]}}  (staff)
PUT    /api/activities/:activityId/rubric                        {rubricId | null}  attach or detach (teacher)
PUT    /api/activities/:activityId/submissions/:studentId/rubric {assessments: [{criterionId, ratingId?, points?, comment?}], score?, feedback?}
                                                                 -> {submission, assessments, rubricTotal}

GET    /api/courses/:courseId/gradebook                          {groups, activities, students: [{cells, grade}]}
GET    /api/courses/:courseId/gradebook/export                   text/csv
POST   /api/courses/:courseId/gradebook/import/preview           {csv} -> GradebookImportPlan (nothing written)
POST   /api/courses/:courseId/gradebook/import                   {csv} -> {applied, unchanged}; 400 with {errors} if the file has any
```

`Rubric` is `{id, courseId, title, pointsPossible, criteria: [{id, title, description, points, ratings: [{id, label, description, points}]}], assessed, updatedAt}`. Gradebook cells carry `dropped`, each `grade` carries `dropped` (activity ids) and so does each of its groups; portal grade activities carry `dropped` too.

## CSV import

The import reads the export's own shape, so the workflow is export, edit in a spreadsheet, import. It is two calls with the same body: **preview** plans and writes nothing; **apply** plans again from the current marks (it does not trust the client's preview) and writes every change in one transaction, or nothing if the file has any error.

- **Students** are matched by the `Student ID` column (the export includes it), else `Email` (the student's sign-in email), else `First name` + `Last name` (case- and space-insensitive), which must name exactly one student on the active/completed roster. An unknown, ambiguous or repeated student is a row error.
- **Columns** match an activity by the export's `Title (points)` header, or by a bare title that names exactly one published/closed activity. Two activities with the same title are an error on that column. Everything else - `Status`, group `%` columns, `Total %`, `Letter`, anything unknown - is ignored. The export's formula guard (a leading `'`) is undone.
- **Cells**: blank is skipped. A number sets the mark - it must be 0..points with at most two decimals - and lifts any excuse. `EX` excuses (keeping any score). A value equal to the current mark *at two decimals* is not a change, so re-importing an untouched export changes nothing.
- **Quizzes** are imported like any other column: because unchanged cells are skipped and quiz scores compare at two decimals (the precision the export writes), a quiz's auto-score is only replaced where the sheet holds a different number - which is the teacher saying so. Feedback and the student's own work are never touched.
- The file is JSON (`{csv}`), up to 1 MB of text.

Wire types are in `frontend/lib/courses/types.ts`.

## How a course grade is calculated

`gradebook.calc.ts`:

1. An activity counts when it is published or closed, not `omit_from_final_grade`, and the student's submission is graded and not excused. Unmarked work is ignored - the grade is the grade *so far*.
2. **Drop rules**, per student and per group (Ungrouped has none), among that student's counted marks: drop the `drop_lowest` marks that hurt the group most, then the `drop_highest` that help it most of what is left. With unequal points "lowest" is not the smallest percentage - the dropped set is the one whose removal leaves the best (or, for highest, the worst) earned ÷ possible over what remains, as Canvas does. The search is exhaustive while the number of ways to choose stays under 5,000, and an exact ratio search (Dinkelbach's method) beyond that. **At least one counted mark is always kept**, ties keep the earlier activity, and a set with no possible points (only zero-point work) is never preferred. Dropped activities are reported, not deleted.
3. Per group: score earned ÷ points available over the kept marks, as a percentage.
4. If any group has a weight above 0, the total is the weighted average **over the groups that have counted work** (an empty group drops out and the rest rescale); unweighted groups and ungrouped work count 0 in that case. If no group has a weight, the total is all points earned ÷ all points available.
5. The letter comes from the course's grade scale, else the school default: the band with the highest minimum the percentage reaches.

Totals are computed from full-precision scores and rounded to two decimals once, at the end.
