# Auth DTOs (`src/auth/dto`)

These are the request body classes for the `/api/auth` routes. They are validated by the global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) and documented in Swagger. Unknown fields are rejected with a 400.

## Files

| File | Class | Used by | Validation |
|------|-------|---------|------------|
| `send-otp.dto.ts` | `SendOtpDto` | `POST /api/auth/otp/send` and `POST /api/auth/dev/code` | `email`: required, must be a valid email. |
| `verify-otp.dto.ts` | `VerifyOtpDto` | `POST /api/auth/otp/verify` | `email`: required, a valid email. `token`: required string. The 8-digit code `EmailCodeService` emailed. |
| `onboard.dto.ts` | `OnboardDto` | `PATCH /api/auth/onboard` | `firstName` and `lastName`: required strings of at most 100 characters. `schoolId`: optional UUID, which files a join request. `accountType`: optional, `'staff'` or `'student'` (default staff). The account type only picks the onboarding flow; it never grants a privilege. |
| `update-profile.dto.ts` | `UpdateProfileDto` | `PATCH /api/auth/profile` | `firstName` and `lastName`: required strings of at most 100 characters. |
| `claim-student.dto.ts` | `ClaimStudentDto` | `POST /api/auth/join-school` | `code`: required string of at most 32 characters. `StudentMembershipService` ignores case and dashes. |

The avatar upload routes use DTOs from `src/images/dto`, not from this folder.

## Adding a DTO

1. Create `<action>.dto.ts` with a class whose fields carry `class-validator` decorators and `@ApiProperty` / `@ApiPropertyOptional`.
2. Type the `@Body()` parameter in `auth.controller.ts` with it. Controllers import it through the `@/auth/dto/<file>` alias.
3. Map the camelCase fields to snake_case `user_profile` columns in `auth.service.ts`.
