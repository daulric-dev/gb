# Student (`src/student`)

The school's student roster, as staff see it: list and search students, look one up, see their full profile (courses, linked login, guardians), add and edit records. A `student.student` row is a person on the roster; it may or may not be linked to a login (`user_profile_id`). Linking logins, join codes and duplicate merging are in [`src/student-account`](../student-account/README.md); what a student sees of themselves is in [`src/student-portal`](../student-portal/README.md).

Every query is scoped to the caller's active school (`user_profile.school_id`, via `userSchoolId()` from `src/common`).

## What it provides

### HTTP routes

`@Controller('students')` with `@UseGuards(AuthGuard, PermissionGuard)`; each route names the catalog permission it needs.

| Method | Path | Guard / who may call | What it does |
| --- | --- | --- | --- |
| GET | `/api/students` | `student:read` | The roster sorted by last, first name. Optional `search` (first or last name substring). Without `page`/`cursor` it returns the whole list (cached when not searching), versioned as `student.list`; with them, a page `{ data, meta }`, versioned as `student.paginated`. |
| GET | `/api/students/:id` | `student:read` | One student in the caller's school, or 404. Versioned as `student.detail`. |
| GET | `/api/students/:id/profile` | `student:read` | `{ student, courses, account, guardians }`: enrolments (active first, then by name), the linked login, and guardians from `parent_student_link`. |
| POST | `/api/students` | `student:create` | Create a student. 409 if a student with the same first and last name (case-insensitive) exists in the school. Versioned as `student.created`. |
| PATCH | `/api/students/:id` | `student:update` | Update fields, including `isActive`. Versioned as `student.updated`. |

`/api/students/duplicates...` routes are in `src/student-account`.

**Pagination.** Offset mode (`page`, `pageSize`, default 20) returns totals and `pageCount`. Cursor mode (`cursor`, `cursorColumn`, `cursorDirection`) fetches one extra row to set `hasMore` and `nextCursor`; allowed cursor columns are `id`, `school_id`, `user_profile_id`, `first_name`, `last_name`, `gender`, `date_of_birth`, `enrollment_date`, `is_active`. Any other `cursorColumn` is a 400 (`cursorColumn must be one of: ...`); only the map's own keys count, so names such as `constructor` are refused too. The query DTO extends `PaginationQueryDto` from `src/pagination`.

**Search.** The term is trimmed, limited to 64 characters, and `, ( ) * % _ \` are stripped before a case-insensitive `contains` match.

### Services / exports

- `StudentService`: `create`, `findAll`, `findAllPaginated`, `findOne`, `profile`, `update`. **Not exported** - no other module injects it.

### Other

- `student.rows.ts` - `serializeStudent()` turns Prisma `Date` columns into `YYYY-MM-DD` strings so the JSON shape matches what clients have always received; `StudentRow` is its type.
- `transformer.ts` - v1 transformers (`v1StudentList`, `v1StudentDetail`, `v1StudentCreated`, `v1StudentUpdated`, `v1StudentPaginated`), all pass-through, registered under `student.*` by `src/versioning/transformer-registry.ts`.

## Used by

- `src/app.module.ts` imports `StudentModule`; `src/versioning/transformer-registry.ts` imports `./transformer`.
- Cache contract: `update()` deletes `student-context:<userProfileId>` when `isActive` changes, so `StudentGuard` in `src/student-portal` notices a deactivation on the student's next request. `src/student-account` drops `students:<schoolId>` when membership changes.
- Web: `frontend/app/dashboard/students/page.tsx` (list and search), `students/[studentId]/page.tsx` (profile), `students/_components/CreateStudentForm.tsx` and `EditStudentForm.tsx`, `dashboard/courses/[courseId]/people/_components/AddStudentsDialog.tsx`, `dashboard/_components/AdminDashboard.tsx`.
- Mobile: `mobile/app/(tabs)/students.tsx`, `mobile/src/features/students/StudentForm.tsx`, `mobile/src/features/dashboard/AdminDashboard.tsx`.
- Scripts: `scripts/smoke.ts` (search), `scripts/student-flow-check.ts` (a student is denied `GET /students`).

## Depends on

- `PrismaService`, `CacheService` (global).
- `userSchoolId()` and `isNotFound()` / `isoDate()` / `dateOnly()` from `src/common`; `parseDateOnly()` from `src/academic-year/academic-year.rows.ts`.
- `AuthGuard`, `PermissionGuard`, `@RequirePermission`, `VersioningService`, `PaginationQueryDto`.

## Data

- `student.student` - read, created, updated ([`student.prisma`](../../prisma/schema/student.prisma)).
- `student.parent_student_link` - read for guardians ([`student.prisma`](../../prisma/schema/student.prisma)).
- `course.course_student` with `course.course` - read for the profile's courses ([`course.prisma`](../../prisma/schema/course.prisma)).
- `public.user_profile` - read for the caller's school and the linked account ([`school.prisma`](../../prisma/schema/school.prisma)).

Cache: `students:<schoolId>` (30 days; appended on create, replaced on update, skipped when searching), `student-context:<userProfileId>` (deleted on activation change).

## Configuration

None.

## Files

| File | Purpose |
| --- | --- |
| `student.module.ts` | Declares the controller and `StudentService`. |
| `student.controller.ts` | The routes above. |
| `student.service.ts` | Roster queries, pagination, profile, create/update, cache maintenance. |
| `student.rows.ts` | `serializeStudent()` / `StudentRow`. |
| `transformer.ts` | v1 response transformers. |
| `dto/` | Request bodies and the list query - see [dto/README.md](./dto/README.md). |
| `student.service.test.ts` | Unit tests. |

## Tests

```bash
cd backend && bun test src/student
```

Covers create (duplicate name 409, no school 400, cache append and sort), findAll (cache hit, search bypasses cache), findAllPaginated (offset totals, cursor look-ahead, unknown or inherited `cursorColumn` is a 400), update (cache replace, 404) and profile (courses, account and guardians joined).

## See also

- [docs/content/backend/student.md](../../../docs/content/backend/student.md)
- [src/student-account/README.md](../student-account/README.md), [src/student-portal/README.md](../student-portal/README.md), [src/pagination/README.md](../pagination/README.md), [src/versioning/README.md](../versioning/README.md)
