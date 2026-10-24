# Term DTOs (`src/term/dto`)

Request bodies for [`term.controller.ts`](../term.controller.ts), validated by the global `ValidationPipe` (unknown properties are a 400).

| File | Class | Used by | Fields and rules |
| --- | --- | --- | --- |
| `create-term.dto.ts` | `CreateTermDto` | `POST /api/terms` | `academicYearId` (required UUID), `name` (required string, max 60, free text), `startDate` and `endDate` (required ISO date strings), optional `sortOrder` (integer 0-50). |
| `update-term.dto.ts` | `UpdateTermDto` | `PATCH /api/terms/:id` | All optional: `name` (non-empty, max 60), `startDate`, `endDate`, `sortOrder` (0-50). A term cannot move to another year. |

Rules enforced in `TermService` rather than here: `startDate` must be before `endDate` on create, the trimmed name must not be blank, and the name must be unique within the year (409).

## Adding a DTO

Add a class here with `class-validator` decorators on every property and use it as the controller's `@Body()` type.
