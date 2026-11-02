# School DTOs (`src/school/dto`)

Request bodies for [`school.controller.ts`](../school.controller.ts). They are validated by the global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`), so unknown properties are rejected with a 400.

| File | Class | Used by | Fields and rules |
| --- | --- | --- | --- |
| `create-join-request.dto.ts` | `CreateJoinRequestDto` | `POST /api/schools/:schoolId/join-requests` | Optional `message` (string, max 500). |
| `update-upload-limit.dto.ts` | `UpdateUploadLimitDto` | `PATCH /api/schools/current/upload-limit` | `maxUploadMb` (required; an integer from 1 to 1000, or null to use the platform default). The service also refuses values above `UPLOAD_MAX_MB`. |
| `approve-join-request.dto.ts` | `ApproveJoinRequestDto` | `PATCH /api/schools/join-requests/:requestId/approve` | Optional `role` (`admin`, `member` or `teacher`; may be null), optional `customRoleIds` (array of UUID v4). The service also checks each id belongs to the school and is not a system role. |

The controller unpacks each body before calling the service. Schools are created by organisation admins (`POST /api/organisation/schools`, see [`src/organisation`](../../organisation/README.md)), not here.

## Adding a DTO

Create `<action>.dto.ts` here with a class whose properties carry `class-validator` decorators (and `@ApiProperty` / `@ApiPropertyOptional` for Swagger), then type the controller's `@Body()` with it. Every property the client may send needs a decorator, or the whitelist will reject it.
