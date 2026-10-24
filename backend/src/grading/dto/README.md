# Grading DTOs (`src/grading/dto`)

Request bodies for the grading routes, and for the student portal's hand-in routes. They are validated by the global `ValidationPipe`, and numbers are coerced with `@Type(() => Number)`. The services then enforce the rules that depend on data: course role, activity status, a score being at most the activity's points, levels fitting their criterion, a group belonging to the course, and so on.

Marks and rubric points may have at most **two decimal places** (`IsNumber({ maxDecimalPlaces: 2 })`), because that is all the API ever shows.

## `activity.dto.ts`

| Class | Used by | Key rules |
| --- | --- | --- |
| `CreateActivityDto` | `POST /api/courses/:courseId/activities` | `kind`: `quiz`, `assignment` or `offline`. `title`: non-empty, at most 200. `instructions`: optional. `points`: number, at least 1. `dueAt`: optional ISO date. `assignmentGroupId`: optional UUID. `allowFile` and `allowText`: optional booleans. `maxAttempts`: optional int, at least 0 (0 means unlimited; omitted means 1). |
| `UpdateActivityDto` | `PATCH /api/activities/:activityId` | The same fields, all optional. `assignmentGroupId` may be `null` (Ungrouped). Adds `omitFromFinalGrade` (boolean). |
| `AddQuestionDto` | `POST /api/activities/:activityId/questions` | `prompt`: non-empty, at most 500. `kind`: `multiple_choice`, `true_false` or `short_answer`. `points`: optional, at least 0.01. `options`: array of `QuestionOptionDto`. |
| `UpdateQuestionDto` | `PATCH /api/activities/:activityId/questions/:questionId` | `prompt`, `points` and `options` are all optional. `options` replaces the whole list. |
| `QuestionOptionDto` | nested in the two question DTOs | `label`: non-empty, at most 300. `isCorrect`: boolean. |
| `GradeSubmissionDto` | `PATCH /api/activities/:activityId/submissions/:studentId/grade`, `POST /api/activities/submissions/:submissionId/grade` | `score`: at least 0, at most 2 decimals. `feedback`: optional, at most 2000. |
| `ExcuseSubmissionDto` | `PATCH /api/activities/:activityId/submissions/:studentId/excuse` | `excused`: boolean. `reason`: optional, at most 500. |
| `SubmitAssignmentDto` | `POST /api/portal/me/activities/:activityId/submit` (`student-portal/portal-activity.controller.ts`) | `textBody`: optional string. `fileId`: optional UUID. |
| `SubmitQuizDto` / `QuizAnswerDto` | `POST /api/portal/me/activities/:activityId/quiz` (`student-portal/portal-activity.controller.ts`) | `answers`: an array. Each answer has `questionId` (UUID), plus `optionId` (optional UUID) for the choice kinds or `text` (optional, at most 500) for a short answer. |

The service adds its own checks. Choice questions need at least two options with exactly one correct, and a short answer needs at least one accepted wording. An assignment must accept a file or text.

## `assignment-group.dto.ts`

| Class | Used by | Key rules |
| --- | --- | --- |
| `CreateAssignmentGroupDto` | `POST /api/courses/:courseId/assignment-groups` | `name`: non-empty, at most 100. `weight`: optional, 0 to 100, or null for unweighted. `dropLowest` and `dropHighest`: optional ints, 0 to 50. |
| `UpdateAssignmentGroupDto` | `PATCH /api/courses/:courseId/assignment-groups/:groupId` | The same fields, all optional. `weight: null` clears the weight. |
| `ReorderAssignmentGroupsDto` | `PATCH /api/courses/:courseId/assignment-groups/reorder` | `groupIds`: a non-empty array of UUIDs |

## `rubric.dto.ts`

| Class | Used by | Key rules |
| --- | --- | --- |
| `CreateRubricDto` | `POST /api/courses/:courseId/rubrics` | `title`: non-empty, at most 200. `criteria`: 1 to 30 `RubricCriterionDto`. |
| `UpdateRubricDto` | `PATCH /api/courses/:courseId/rubrics/:rubricId` | `title` optional. `criteria` optional (1 to 30), and replaces every criterion. Refused once the rubric has been used to mark anyone. |
| `RubricCriterionDto` | nested | `title`: non-empty, at most 200. `description`: optional, at most 2000. `points`: 0 to 100000, at most 2 decimals. `ratings`: 1 to 10 `RubricRatingDto`. |
| `RubricRatingDto` | nested | `label`: non-empty, at most 100. `description`: optional, at most 1000. `points`: at least 0, at most 2 decimals. The service also checks it is no more than the criterion's points. |
| `AttachRubricDto` | `PUT /api/activities/:activityId/rubric` | `rubricId`: a UUID, or `null` to detach |
| `AssessRubricDto` | `PUT /api/activities/:activityId/submissions/:studentId/rubric` | `assessments`: at most 30 `CriterionAssessmentDto`. `score`: optional override, at least 0, at most 2 decimals. `feedback`: optional, at most 2000. |
| `CriterionAssessmentDto` | nested | `criterionId`: UUID. `ratingId`: optional UUID or null. `points`: optional, at least 0, at most 2 decimals; defaults to the level's points. `comment`: optional, at most 2000. |

## `gradebook-import.dto.ts`

| Class | Used by | Key rules |
| --- | --- | --- |
| `ImportGradebookDto` | `POST /api/courses/:courseId/gradebook/import/preview` and `/import` | `csv`: non-empty string, at most 1,000,000 characters, in the shape the export produces |

## Adding a DTO

Put the class in the file for its area, or add a new `<area>.dto.ts`. Use class-validator rules and `@ApiProperty` or `@ApiPropertyOptional`. Nested arrays need `@ValidateNested({ each: true })` together with `@Type(() => ...)`. For a mark or points field, reuse the two-decimal rule. Use the class as the `@Body()` type in the controller, and put any rule that depends on the course, the activity or another field in the service.
