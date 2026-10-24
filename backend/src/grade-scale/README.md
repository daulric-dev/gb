# Grade scales (`src/grade-scale`)

A school's grade scales: named sets of percentage bands (A 90-100, B 80-89 and so on), each with an optional GPA value and a pass/fail flag. One scale per school can be the default. A course can point at a specific scale (`course.grade_scale_id`). When it does not, the gradebook falls back to the school's default to turn a course percentage into a letter.

This module only manages the scales. The letter is worked out in `grading` (`gradebook.calc.ts`, `letterFor()`), which reads the band tables directly.

## What it provides

### HTTP routes

Every route is behind `AuthGuard` and `PermissionGuard`. Writes also need `AdminGuard` (a school admin). Every route works on the caller's active school only; a scale from another school is reported as 404.

| Method | Path | Guard | What it does |
| --- | --- | --- | --- |
| GET | `/api/grade-scales` | `grade-scale:read` | List the school's scales (default first, then by name), without bands |
| GET | `/api/grade-scales/default` | `grade-scale:read` | The default scale with bands, or null. Cached 24 h under `grade-scale:default:<schoolId>`. |
| GET | `/api/grade-scales/:id` | `grade-scale:read` | One scale with bands |
| POST | `/api/grade-scales` | `grade-scale:create` + `AdminGuard` | Create a scale and its bands in one transaction (`CreateGradeScaleDto`). `isDefault: true` clears the old default first. |
| PATCH | `/api/grade-scales/:id` | `grade-scale:update` + `AdminGuard` | Rename, or set or unset default (`UpdateGradeScaleDto`) |
| PUT | `/api/grade-scales/:id/bands` | `grade-scale:update` + `AdminGuard` | Replace all bands atomically (`ReplaceBandsDto`). A failed insert keeps the old bands. |
| POST | `/api/grade-scales/:id/set-default` | `grade-scale:update` + `AdminGuard` | Make this the school's default |
| DELETE | `/api/grade-scales/:id` | `grade-scale:delete` + `AdminGuard` | Delete the scale |

Each response goes through the versioning layer (`VersioningService.resolve(req, 'gradeScale.<name>')`).

**Band rules** (`validateBands`):

- `min <= max` in every band.
- No two bands overlap. After sorting by min, each band's max must be below the next band's min.
- Labels are unique within a scale.
- Gaps between bands are allowed. The gradebook's `letterFor()` gives a percentage in a gap the label of the nearest band below it, and no letter when it is below every band.

### Services / exports

`GradeScaleModule` exports `GradeScaleService`:

- `list(userId)`, `getDefault(userId)` and `get(id, userId)`.
- `create(userId, dto)`, `update(id, userId, dto)`, `replaceBands(id, userId, dto)`, `setDefault(id, userId)` and `delete(id, userId)`.

Each write invalidates the `grade-scale:default:<schoolId>` cache entry. No other module injects the service today.

### Other

`transformer.ts` holds the wire types `GradeScaleSummary`, `GradeScaleDetail` and `GradeScaleBand`, and the identity v1 transformers. `src/versioning/transformer-registry.ts` registers them under `gradeScale.list`, `detail`, `created`, `updated`, `bandsReplaced`, `defaultSet` and `deleted`.

## Used by

- `src/app.module.ts` imports `GradeScaleModule`.
- `src/versioning/transformer-registry.ts` imports `@/grade-scale/transformer`.
- `src/grading/gradebook.service.ts` reads `grading.grade_scale` and `grade_scale_band` directly (course scale, else school default) for letters.
- `src/course/course.service.ts` validates and stores `gradeScaleId` on a course, and `course-copy.service.ts` copies it.
- Front end:
  - `frontend/app/dashboard/grade-scales/page.tsx` and `_components/ScaleForm.tsx` use list, get, set-default, delete, create, patch and bands.
  - `frontend/app/dashboard/courses/[courseId]/settings/page.tsx` lists scales to pick one for a course.
- Mobile: `mobile/app/grade-scales/index.tsx` and `mobile/src/features/grade-scales/ScaleForm.tsx`.

## Depends on

- `PrismaService`.
- `CacheService`.
- `VersioningService` (global).
- `AuthGuard` and `AdminGuard` (`src/auth`).
- `PermissionGuard` and `@RequirePermission` (`src/permission`).
- `isoDate()`, `isUniqueViolation()` and `num()` from `src/common/db-values.ts`.

## Data

- `grading.grade_scale`: `school_id`, `name`, `scale_type` (`letter`, `gpa` or `pass_fail`), `is_default`, `created_by` and `updated_by`. A unique index allows only one default per school, which is why a second default is a 409.
- `grading.grade_scale_band`: `label`, `min_percentage`, `max_percentage`, `gpa_points`, `is_pass` and `sort_order`. Labels are unique per scale.
- `public.user_profile.school_id` is read to find the caller's school.

See [`prisma/schema/grading.prisma`](../../prisma/schema/grading.prisma).

## Configuration

None.

## Files

| File | Purpose |
| --- | --- |
| `grade-scale.module.ts` | Module; exports `GradeScaleService` |
| `grade-scale.controller.ts` | Routes under `/api/grade-scales` |
| `grade-scale.service.ts` | CRUD, band validation, default handling |
| `transformer.ts` | Wire types and v1 transformers |
| `grade-scale.service.test.ts`, `grade-scale.controller.test.ts` | Unit tests (see Tests) |
| `dto/` | Request DTOs, see [`dto/README.md`](dto/README.md) |

## Tests

```bash
cd backend && bun test src/grade-scale
```

- `grade-scale.service.test.ts` - `GradeScaleService` with `createMockPrisma()` and the in-memory cache:
  - School resolution: no school, or a failed profile lookup, is `400`.
  - `list`: school-scoped, default first then by name, no bands; a query failure is `400`.
  - `get`: bands sorted by `sort_order` with `Decimal` values turned into numbers and `gpaPoints: null` kept; missing scale and another school's scale are both `404`; scale or band load failures are `400`.
  - `getDefault`: `null` (not cached) when there is none, cached 24 h under `grade-scale:default:<schoolId>`, served from the cache without a query, and a lookup failure treated as no default.
  - Band validation: min > max, overlaps regardless of input order, touching bands (`max == next min`) count as overlap, gaps and `min == max` allowed, duplicate labels rejected (case-sensitive), validation runs before any database access, and `replaceBands` validates too.
  - `create`: scale and bands in one transaction with the stored row shapes (`sortOrder` defaulting to index, `gpa_points` null), `isDefault` clears the old default before inserting, cache invalidated; a unique violation on the scale or the bands is `409`, other failures `400`, and a failed create leaves the cache untouched.
  - `update`: rename and audit stamps, set/unset default only when it changes (clearing the old default first), cross-school `404` with nothing written, `409` / `400` on failures, cache invalidated.
  - `replaceBands`: delete then insert then stamp in one transaction, cross-school `404`, delete failure `400`, insert failure leaves the cache and skips the stamp.
  - `setDefault`: already default returns without writing; otherwise clears then sets; failures `400`; cross-school `404`.
  - `delete`: deletes and invalidates; cross-school `404`; failure `400`.
- `grade-scale.controller.test.ts` - reads route metadata: the class is behind `AuthGuard` + `PermissionGuard`, every route has the documented `grade-scale:*` key, and only the write routes add `AdminGuard`; and the handlers pass the caller id to the service and version the result with the right transformer name.

The letter lookup the gradebook uses is tested in `src/grading/gradebook.calc.test.ts` (`letterFor`).

## See also

- [`../grading/README.md`](../grading/README.md): how a course percentage becomes a letter
- [`../permission/README.md`](../permission/README.md): the `grade-scale:*` keys
