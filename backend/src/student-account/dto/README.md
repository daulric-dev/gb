# Student account DTOs (`src/student-account/dto`)

| File | Class | Used by | Fields and rules |
| --- | --- | --- | --- |
| `issue-claim-code.dto.ts` | `IssueClaimCodeDto` | `POST /api/schools/join-code` (`SchoolJoinCodeController.issue`) | Optional `ttlDays`: converted to a number (`@Type(() => Number)`), integer, 1-90. Defaults to 14 in `StudentMembershipService.issueCode()`, which checks the range again. |

The name still says "claim code" from when codes were issued per student; it now configures the school-wide join code.

The body for redeeming a code is not here: `POST /api/auth/join-school` uses `ClaimStudentDto` from `src/auth/dto/claim-student.dto.ts`.

## Adding a DTO

Add a class with `class-validator` decorators (plus `@ApiPropertyOptional` for Swagger) and use it as the controller's `@Body()` type. Numeric fields that may arrive as strings need `@Type(() => Number)` from `class-transformer`.
