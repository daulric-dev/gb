# Attendance DTOs (`src/attendance/dto`)

All the attendance request bodies are in one file, `attendance.dto.ts`. They are validated by the global `ValidationPipe`, which rejects unknown fields and transforms nested objects with `@Type`, and they are documented in Swagger.

## Classes in `attendance.dto.ts`

| Class | Used by | Validation |
|-------|---------|------------|
| `OpenAttendanceDto` | `POST /api/courses/:courseId/attendance/sessions` | `durationMinutes`: optional integer from 1 to 60 (default 5). `requireCode`: optional boolean (default true; `false` means no 4-digit code). `lateAfterMinutes`: optional integer from 0 to 60, or null. `title`: optional string of at most 120 characters. `location`: an optional nested `SessionLocationDto`. |
| `SessionLocationDto` | Nested in `OpenAttendanceDto.location` | `latitude` from −90 to 90 and `longitude` from −180 to 180 (numbers). `radiusM`: optional integer from 10 to 5000 (default 100). |
| `SetAttendanceRecordDto` | `PATCH /api/courses/:courseId/attendance/sessions/:sessionId/records/:studentId` | `status`: one of `ATTENDANCE_STATUSES` (`present`, `late`, `absent`, `excused`). `note`: optional string of at most 500 characters. An empty note is stored as null. |
| `CheckInDto` | `POST /api/portal/me/attendance/:sessionId/check-in` | Every field is optional. `code`: non-empty string of at most 10 characters (the room code). `qrToken`: non-empty, at most 64 characters, used in place of the code. `qrClaim`: non-empty, at most 80 characters, from `scan-claim`. `location`: a nested `CheckInLocationDto`. Which fields are actually required depends on the session (see the parent README). |
| `CheckInLocationDto` | Nested in `CheckInDto.location` | `latitude` and `longitude` within the ranges above. `accuracy`: optional number of 0 or more (metres). |
| `ScanClaimDto` | `POST /api/attendance/scan-claim` | `sessionId`: a UUID. `qrToken`: non-empty string of at most 64 characters. |

The status list comes from `../attendance.types.ts`. If you add a status there, `SetAttendanceRecordDto` accepts it automatically.

## Adding a DTO

1. Add the class to `attendance.dto.ts`. Decorate every field with `class-validator` and `@ApiProperty` / `@ApiPropertyOptional`. Nested objects need both `@ValidateNested()` and `@Type(() => Child)`.
2. Use it as a `@Body()` type in the right controller.
3. Accept the fields in the matching input interface in `attendance.service.ts` (`OpenAttendanceInput`, `CheckInInput`).
