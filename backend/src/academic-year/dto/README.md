# Academic Year DTOs (`src/academic-year/dto`)

These are the request body classes for the academic year routes. They are validated with `class-validator` by the app's global `ValidationPipe` and documented in Swagger with `@ApiProperty`. Field names are camelCase in requests. The service maps them to the snake_case columns of `public.academic_year`, and it converts the date strings with `parseDateOnly` from `../academic-year.rows.ts`.

## Files

| File | Class | Used by | Validation |
|------|-------|---------|------------|
| `create-academic-year.dto.ts` | `CreateAcademicYearDto` | `POST /api/academic-years` | `name`: required string, at most 50 characters. `startDate` and `endDate`: required ISO date strings (`@IsDateString`). The service also checks that `startDate` is before `endDate`. |
| `update-academic-year.dto.ts` | `UpdateAcademicYearDto` | `PATCH /api/academic-years/:id` | Every field is optional. `name` is a string of at most 50 characters. `startDate` and `endDate` are ISO date strings. There is no `isActive` field, so sending one is a 400: use `PATCH /:id/activate` (which deactivates the school's other years in the same transaction) or `/:id/deactivate` to change the active year. |

## Adding a DTO

1. Create `<action>-academic-year.dto.ts` that exports a class with `class-validator` decorators and `@ApiProperty` / `@ApiPropertyOptional` on each field.
2. Type the `@Body()` parameter of the controller method with it.
3. Map its fields to the snake_case Prisma columns in `academic-year.service.ts`.
