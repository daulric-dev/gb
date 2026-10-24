# Academic Year (`src/academic-year`)

This module manages a school's academic years. An academic year is a name (for example "2025/2026") and a date range. Each school can have at most one **active** year, which is how the rest of the app knows which year is "current". Every request is scoped to the caller's school: the service looks up `user_profile.school_id` for the signed-in user and only reads or writes years belonging to that school. Lists and the active year are cached through `CacheService`.

## What it provides

### HTTP routes

The controller is guarded with `AuthGuard` and `PermissionGuard` at class level. Every route needs a valid session plus the `academic-year` permission listed below. Responses go through `VersioningService.resolve()` using the `academicYear.*` transformers.

| Method | Path | Permission | What it does |
|--------|------|------------|--------------|
| POST | `/api/academic-years` | `academic-year:create` | Creates a year for the caller's school. Rejects the request if `startDate` is not before `endDate`. New years always start inactive. |
| GET | `/api/academic-years` | `academic-year:read` | Lists the school's years, newest `start_date` first (cached). Returns `[]` on a database error. |
| GET | `/api/academic-years/active` | `academic-year:read` | Returns the active year, or `null` when none is active. More than one active year is logged as an error and also returns `null`. |
| GET | `/api/academic-years/:id` | `academic-year:read` | Returns one year of the caller's school, or 404. |
| PATCH | `/api/academic-years/:id` | `academic-year:update` | Updates `name`, `startDate` and/or `endDate`. There is no `isActive` field (sending one is a 400 from the `ValidationPipe`); use the activate/deactivate routes instead. |
| PATCH | `/api/academic-years/:id/activate` | `academic-year:update` | In one transaction, deactivates every year of the school and activates this one. |
| PATCH | `/api/academic-years/:id/deactivate` | `academic-year:update` | Sets `is_active = false` on this year. |

### Services / exports

- **`AcademicYearService`** (exported): `create`, `findAll`, `findActive`, `findOne`, `update`, `setActive`, `deactivate`. Each takes the caller's user id first and resolves the school from it. No other module currently injects it.

### Other

- **`academic-year.rows.ts`**
  - `parseDateOnly(value)` turns a request date string (`"2025-09-01"` or an ISO timestamp) into a `Date` at midnight UTC for that calendar date, so a time zone in the string never shifts the stored `date`. The term and student services use it too.
  - `serializeAcademicYear(row)` returns the row with `start_date` and `end_date` formatted as `YYYY-MM-DD` (via `dateOnly` from `@/common/db-values`). `AcademicYearRow` is the type of that result.
- **`transformer.ts`**: the v1 response transformers (`v1YearList`, `v1YearDetail`, `v1YearCreated`, `v1YearUpdated`). They return the data unchanged. `src/versioning/transformer-registry.ts` registers them under `academicYear.list/detail/created/updated`.
- **Cache keys**: `academic-years:<schoolId>` (the list) and `academic-year-active:<schoolId>` (the active year). Both have a 30-day TTL. Create and update patch the cached entries in place with `cache.update()`. Activate and deactivate clear everything with the `academic-year` prefix by calling `cache.deleteByPrefix('academic-year')`.

## Used by

- `src/app.module.ts` imports `AcademicYearModule`.
- `src/term/term.service.ts` and `src/student/student.service.ts` import `parseDateOnly` from `academic-year.rows.ts` (term start/end dates; student date of birth and enrolment date).
- `src/versioning/transformer-registry.ts` registers the transformers.
- Frontend:
  - `frontend/app/dashboard/academic-calendar/page.tsx`, `_components/CreateYearForm.tsx` and `_components/EditYearForm.tsx` (the academic calendar admin page).
  - `frontend/lib/courses/calendar.ts` (`GET /academic-years` for year options).
- Mobile:
  - `mobile/app/academic-calendar/index.tsx` and `mobile/src/features/academic-calendar/YearForm.tsx`.
  - `mobile/src/features/dashboard/AdminDashboard.tsx` calls `GET /academic-years/active`.
- `backend/scripts/smoke.ts` calls `GET /academic-years`.

## Depends on

- `PrismaService` (global) for database access.
- `CacheService` (global, from `src/cache`).
- `AuthGuard` (`src/auth`), `PermissionGuard` and `@RequirePermission` (`src/permission`).
- `VersioningService` (`src/versioning`).

## Data

- Reads and writes `public.academic_year`.
- Reads `public.user_profile.school_id` to find the caller's school.

Both models are in [`prisma/schema/school.prisma`](../../prisma/schema/school.prisma).

## Configuration

None. This module reads no environment variables.

## Files

| File | Purpose |
|------|---------|
| `academic-year.module.ts` | Nest module: registers the controller and the service, and exports the service. |
| `academic-year.controller.ts` | The HTTP routes listed above. |
| `academic-year.service.ts` | School scoping, validation, Prisma queries and caching. |
| `academic-year.rows.ts` | `parseDateOnly` and `serializeAcademicYear` helpers. |
| `transformer.ts` | The v1 response transformers. |
| `dto/` | Request body DTOs. See [dto/README.md](./dto/README.md). |
| `academic-year.service.test.ts` | Unit tests for the service. |

## Tests

```bash
cd backend && bun test src/academic-year
```

`academic-year.service.test.ts` covers:

- start-before-end validation on create;
- calendar dates being stored and returned as `YYYY-MM-DD`;
- cache hit and cache miss in `findAll`;
- `findActive` returning `null`;
- `update` patching both cache keys;
- `setActive` and `deactivate` calling `deleteByPrefix`.

## See also

- [docs/content/backend/academic-year.md](../../../docs/content/backend/academic-year.md)
- [Term module](../term/) (terms belong to an academic year)
- [Cache module](../cache/README.md)
- [Versioning](../versioning/)
