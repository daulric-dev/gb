# Term (`src/term`)

Terms inside an academic year - "Michaelmas", "Semester 1", "Fall 2026" - with start and end dates and a sort order. Names are free text; the old fixed names `michaelmas`, `hilary` and `trinity` still sort 1, 2, 3 when no order is given, and any other name goes after the year's existing terms. Courses can point at a term (`course.term_id`), which is why a term in use cannot be deleted.

Every route checks that the academic year (or the term's year) belongs to the caller's active school.

## What it provides

### HTTP routes

`@Controller('terms')` with `@UseGuards(AuthGuard, PermissionGuard)`.

| Method | Path | Guard / who may call | What it does |
| --- | --- | --- | --- |
| GET | `/api/terms?yearId=<academicYearId>` | `term:read` | Terms of one year, by `sort_order`. 404 if the year is not in the caller's school. Cached. Versioned as `term.list`. |
| GET | `/api/terms/:id` | `term:read` | One term in the caller's school, or 404. Versioned as `term.detail`. |
| POST | `/api/terms` | `term:create` | Create. Start must be before end, the name must not be blank, and a duplicate name in the year is 409. Versioned as `term.created`. |
| PATCH | `/api/terms/:id` | `term:update` | Update name, dates or sort order. Duplicate name is 409. Versioned as `term.updated`. |
| DELETE | `/api/terms/:id` | `term:delete` | Delete; 409 "courses still use it" on a foreign-key block. Returns `{ message: 'Term deleted' }`, versioned as `term.deleted`. |

### Services / exports

- `TermService`: `create`, `findByYear`, `findOne`, `update`, `delete`. **Not exported.**

### Other

- `term.rows.ts` - `serializeTerm()` turns `start_date` / `end_date` into `YYYY-MM-DD` strings; `TermRow` type.
- `transformer.ts` - pass-through v1 transformers (`v1TermList`, `v1TermDetail`, `v1TermCreated`, `v1TermUpdated`, `v1TermDeleted`), registered under `term.*` in `src/versioning/transformer-registry.ts`.

## Used by

- `src/app.module.ts` imports `TermModule`; `src/versioning/transformer-registry.ts` imports `./transformer`.
- Web: `frontend/app/dashboard/academic-calendar/_components/TermsTab.tsx` (list, delete), `CreateTermForm.tsx`, `EditTermForm.tsx`, and `frontend/lib/courses/calendar.ts` (term options for course forms).
- Mobile: `mobile/src/features/academic-calendar/TermsTab.tsx` and `TermForm.tsx`.
- Scripts: `scripts/smoke.ts` lists the demo year's terms.

## Depends on

- `PrismaService`, `CacheService` (global).
- `userSchoolId()`, `isUniqueViolation()`, `isForeignKeyViolation()` from `src/common`; `parseDateOnly()` from `src/academic-year/academic-year.rows.ts`.
- `AuthGuard`, `PermissionGuard`, `@RequirePermission`, `VersioningService`.

## Data

- `public.term` - read, created, updated, deleted ([`school.prisma`](../../prisma/schema/school.prisma)).
- `public.academic_year` - read to check the year is in the caller's school.
- `public.user_profile` - read for the caller's school.

Cache: `terms:<academicYearId>` (30 days; appended and re-sorted on create, replaced on update, deleted on delete).

## Configuration

None.

## Files

| File | Purpose |
| --- | --- |
| `term.module.ts` | Declares the controller and `TermService`. |
| `term.controller.ts` | The routes above. |
| `term.service.ts` | School scoping, sort order, cache maintenance. |
| `term.rows.ts` | `serializeTerm()` / `TermRow`. |
| `transformer.ts` | v1 response transformers. |
| `dto/` | Request bodies - see [dto/README.md](./dto/README.md). |
| `term.service.test.ts` | Unit tests. |

## Tests

```bash
cd backend && bun test src/term
```

Covers create (blank name, date order, year outside the school, duplicate 409, cache append, custom names sorted last), findByYear (cache hit and miss), findOne (school scope, 404), update (cache replace, blank name) and delete (only the year's cache is dropped, foreign-key block 409).

## See also

- [docs/content/backend/term.md](../../../docs/content/backend/term.md), [docs/content/backend/academic-year.md](../../../docs/content/backend/academic-year.md)
- [src/academic-year/README.md](../academic-year/README.md), [src/versioning/README.md](../versioning/README.md)
