# Student DTOs (`src/student/dto`)

Request bodies and the list query for [`student.controller.ts`](../student.controller.ts). The global `ValidationPipe` runs with `whitelist`, `forbidNonWhitelisted` and `transform`, so unknown properties are a 400.

| File | Class | Used by | Fields and rules |
| --- | --- | --- | --- |
| `create-student.dto.ts` | `CreateStudentDto` | `POST /api/students` | `firstName`, `lastName` (required strings, max 100), `gender` (required, `male` or `female`), optional `dateOfBirth` and `enrollementDate` (ISO date strings). |
| `update-student.dto.ts` | `UpdateStudentDto` | `PATCH /api/students/:id` | All optional: `firstName`, `lastName` (max 100), `gender`, `dateOfBirth`, `enrollementDate`, `isActive` (boolean). Sending `null` for a date clears the column (`@IsOptional` lets null through and the service writes null). |
| `list-students.query.dto.ts` | `ListStudentsQueryDto` | `GET /api/students` (query string) | Extends `PaginationQueryDto` (`page` >= 1, `pageSize` 1-100, `cursor`, `cursorColumn`, `cursorDirection` `asc`/`desc`) and adds optional `search` (max 100). It is one DTO on purpose: validating `search` and the paging fields separately made the paging DTO reject `search` as unknown. |

Note the spelling `enrollementDate` in both body DTOs - it is the field name clients send, and the service maps it to the `enrollment_date` column. Renaming it would be a breaking API change.

A `cursorColumn` outside the list in `student.service.ts` (`CURSOR_COLUMNS`) is not rejected by the DTO; in cursor mode the service checks it against that map's own keys and answers 400 (`cursorColumn must be one of: ...`).

## Adding a DTO

Add a class here with `class-validator` decorators on every property (and `@ApiProperty...` for Swagger; the Nest Swagger plugin infers the rest), then use it as the controller's `@Body()` or `@Query()` type. For list endpoints, extend `PaginationQueryDto` from `src/pagination/pagination.dto.ts` rather than validating paging fields twice.
