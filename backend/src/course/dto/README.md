# Course DTOs (`src/course/dto`)

Request validation for the course module's routes, enforced by the global `ValidationPipe`. Business rules (trimming, school ownership of years/terms/scales, "nothing to update", target checks for module items) live in the services.

## Files

### `course.dto.ts`

Also exports `COURSE_STATUSES` (`draft`, `published`, `archived`) and the `CourseStatus` type.

| Class | Route | Key rules |
|-------|-------|-----------|
| `ListCoursesQueryDto` | `GET /api/courses` (query) | Optional `status` (one of the statuses), `termId`, `academicYearId` (UUIDs). |
| `CreateCourseDto` | `POST /api/courses` | `name` required, max 200. Optional `code` (max 40), `description` (max 5000), `academicYearId`, `termId` (UUIDs). |
| `UpdateCourseDto` | `PATCH /api/courses/:courseId` | All optional: `name` (non-empty, max 200), `code` (max 40, nullable), `description` (max 5000, nullable), `status`, `academicYearId` / `termId` / `gradeScaleId` (UUID, nullable), `isTemplate` (boolean). |
| `AddCourseStaffDto` | `POST /api/courses/:courseId/staff` | `userProfileId` UUID; `role` `teacher` or `ta`. |
| `UpdateCourseStaffDto` | `PATCH /api/courses/:courseId/staff/:userProfileId` | `role` `teacher` or `ta`. |
| `EnrollStudentsDto` | `POST /api/courses/:courseId/students` | `studentIds`: 1-500 UUIDs. |
| `JoinCourseDto` | `POST /api/portal/me/courses/join` (in `src/student-portal/student-portal.controller.ts`) | `joinCode`: non-empty string, max 20. |

### `content.dto.ts`

Also exports `MODULE_ITEM_TYPES` (`page`, `activity`, `file`, `link`, `header`, `discussion`) and `ModuleItemType`.

| Class | Route | Key rules |
|-------|-------|-----------|
| `CreateModuleDto` | `POST /api/courses/:courseId/modules` | `title` required, max 200. |
| `UpdateModuleDto` | `PATCH /api/courses/:courseId/modules/:moduleId` | Optional `title` (non-empty, max 200), `isPublished`. |
| `ReorderModulesDto` | `PATCH /api/courses/:courseId/modules/reorder` | `moduleIds`: 1-500 UUIDs. |
| `CreateModuleItemDto` | `POST /api/courses/:courseId/modules/:moduleId/items` | `itemType` one of `MODULE_ITEM_TYPES`. Optional `title` (max 200; required by the service for links and headers), `pageId`, `activityId`, `fileId`, `discussionTopicId` (UUIDs), `url` (http/https only, protocol required, max 2000, so no `javascript:` or `data:` links), `indent` 0-3. |
| `UpdateModuleItemDto` | `PATCH /api/courses/:courseId/modules/:moduleId/items/:itemId` | Optional `title` (max 200; `null` clears the override), `indent` 0-3, `isPublished`, `moduleId` (UUID; moves the item). |
| `ReorderModuleItemsDto` | `PATCH /api/courses/:courseId/modules/:moduleId/items/reorder` | `itemIds`: 1-500 UUIDs. |
| `CreatePageDto` | `POST /api/courses/:courseId/pages` | `title` required, max 200; optional `body` (Markdown, max 100000), `isPublished`. |
| `UpdatePageDto` | `PATCH /api/courses/:courseId/pages/:pageId` | Optional `title` (non-empty, max 200), `body` (max 100000), `isPublished`. |

### `course-copy.dto.ts`

| Class | Route | Key rules |
|-------|-------|-----------|
| `CopyDatesDto` | Base class of the two below | Optional `shiftDays` (integer -3660 to 3660), `sourceStartDate` / `targetStartDate` (strict ISO dates, `YYYY-MM-DD`), `clearDueDates` (boolean). `CourseCopyService.shiftOf` allows at most one method. |
| `CopyCourseDto` | `POST /api/courses/:courseId/copy` | Dates, plus `name` required (max 200), optional `code` (max 40), `academicYearId`, `termId`. |
| `ImportCourseContentDto` | `POST /api/courses/:courseId/import` | Dates, plus `sourceCourseId` (UUID). |

## Adding a DTO or field

Put course, people and roster bodies in `course.dto.ts`, module/item/page bodies in `content.dto.ts`, and copy bodies in `course-copy.dto.ts`. Use `class-validator` decorators with `@ApiProperty` / `@ApiPropertyOptional`, then map the field in the matching service method. A new module item type needs: a value in `MODULE_ITEM_TYPES`, a pointer field here, a value in the `module_item_type` enum and a pointer column on `module_item` in `prisma/schema/course.prisma` (plus a migration updating the `module_item_target_matches_type` check constraint), a case in `ModuleService.resolveTarget`, `targetsOf` and `visibleToStudent`, and repointing in `CourseCopyService.copyContent`.

See the [course README](../README.md).
