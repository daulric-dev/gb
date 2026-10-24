# Student account (`src/student-account`)

Everything that binds a login to a school **as a student**. A school has at most one live **join code** (12 characters from an alphabet without look-alike glyphs, shown as `ABCD-EFGH-JKMN`). Staff issue it and hand it out; a student who signed up and onboarded as a student redeems it, which creates their `student.student` record in that school and links it to their profile. Because a code cannot tell who someone is, a student who was already on the roster ends up with a second record - the **duplicates** routes let staff merge the new record into the existing one.

`StudentMembershipService` is deliberately the only code that writes student membership. Every write ends in `finalise()`, which drops the three cache entries that would otherwise keep showing stale state for up to 30 days: `profile:<userId>`, `student-context:<userId>` and `students:<schoolId>`.

Codes are stored only as an HMAC-SHA256 keyed with `STUDENT_CLAIM_CODE_PEPPER`, never in plain text; the plaintext is returned once, when issued. Redemption, duplicate detection and merging are Postgres functions (in [`prisma/migrations/0_baseline`](../../prisma/migrations/0_baseline/migration.sql)), called with `$queryRaw`.

## What it provides

### HTTP routes

Both controllers use `@UseGuards(AuthGuard, PermissionGuard)`. Issuing is gated on `student:create` because redeeming a code creates a student.

| Method | Path | Guard / who may call | What it does |
| --- | --- | --- | --- |
| GET | `/api/schools/join-code` | `student:read` | `{ activeCode: { expiresAt, issuedAt } \| null, expired }`. Never returns the code. |
| POST | `/api/schools/join-code` | `student:create` | Issue (or reissue) the code; body `IssueClaimCodeDto` (`ttlDays`, default 14, max 90). Deletes any live code and inserts the new one in one transaction. Returns `{ code, expiresAt }` - the only time the code is visible. |
| DELETE | `/api/schools/join-code` | `student:create` | Revoke the live code; 204. |
| GET | `/api/students/duplicates` | `student:read` | `[{ joinedId, existingId, name }]` from `public.student_duplicate_candidates(school)`. Returns `[]` if that function is missing. |
| POST | `/api/students/duplicates/:joinedId/merge/:existingId` | `student:update` | Move the login onto the existing record and drop the record created at join time, via `public.merge_student_records(actor, joined, existing)`. Refused if the joined record already has results (400) or the target already has an account (409). |

Redeeming the code is **not** a route here: it is `POST /api/auth/join-school` in `src/auth/auth.controller.ts` (throttled by the `claim-code` throttler, 10 per 15 min), which calls `StudentMembershipService.joinByCode()`.

### Services / exports

- `StudentMembershipService` (exported):
  - `issueCode(actorUserId, ttlDays?)`, `revokeCode(actorUserId)`, `getCodeStatus(actorUserId)` - scoped to the actor's active school.
  - `joinByCode(userId, rawCode)` - normalises case and dashes, rejects a wrong length without a database call, calls `public.redeem_school_join_code(user, hash)`, and maps its errors: `already_in_a_school` -> 409, `profile_not_found` -> 400 "Complete your profile first", `invalid_join_code` -> 400 (the same message as a wrong-length code). The code is **not** consumed; it stays valid for other students until it expires or is revoked. Returns `{ studentId, schoolId }`.
  - `listDuplicates(actorUserId)`, `mergeDuplicate(actorUserId, joinedId, existingId)`.
  - A missing database function (Postgres `42883`) produces an error telling you to apply the pending migrations.

## Used by

- `src/app.module.ts` imports `StudentAccountModule`.
- `src/auth/auth.module.ts` imports it, and `src/auth/auth.controller.ts` injects `StudentMembershipService` for `POST /api/auth/join-school`.
- Web: `frontend/app/dashboard/students/_components/SchoolJoinCodeDialog.tsx` (status, issue, revoke) and `DuplicateStudentsCard.tsx` (list, merge); students redeem through `frontend/components/auth/join-code-form.tsx` (shown on `frontend/app/schools/page.tsx`), which posts to `/auth/join-school`.
- Mobile: `mobile/src/components/auth/JoinCodeForm.tsx` posts to `/auth/join-school`.
- `scripts/student-flow-check.ts` exercises issue, status, redeem (`/auth/join-school`), duplicates, merge and revoke end to end over HTTP; see [scripts/README.md](../../scripts/README.md).

## Depends on

- `PrismaService`, `CacheService` (global).
- `isoDate()`, `pgCode()`, `raisedMessage()` from `src/common/db-values.ts`.
- `AuthGuard`, `PermissionGuard`, `@RequirePermission`.

## Data

- `student.school_join_code` - created, deleted, read ([`student.prisma`](../../prisma/schema/student.prisma)). One live code per school is a database constraint.
- `public.user_profile` - read for the actor's school.
- `student.student` - read in `mergeDuplicate`; created / updated inside the SQL functions.
- SQL functions: `public.redeem_school_join_code`, `public.student_duplicate_candidates`, `public.merge_student_records`.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `STUDENT_CLAIM_CODE_PEPPER` | dev-only fallback pepper | HMAC key for stored codes. **Required in production** - the service throws at startup without it. Changing it invalidates every unredeemed code. |
| `NODE_ENV` | - | `production` makes the pepper mandatory. |

## Files

| File | Purpose |
| --- | --- |
| `student-account.module.ts` | Declares both controllers, provides and exports `StudentMembershipService`. |
| `school-join-code.controller.ts` | `SchoolJoinCodeController` (`/schools/join-code`) and `StudentDuplicateController` (`/students/duplicates`). |
| `student-membership.service.ts` | Codes, redemption, duplicates, cache invalidation. |
| `dto/` | `IssueClaimCodeDto` - see [dto/README.md](./dto/README.md). |
| `student-membership.service.test.ts` | Unit tests. |

## Tests

```bash
cd backend && bun test src/student-account
```

Covers issuing (grouped code, only the hash stored, reissue is atomic, expiry range), status (never leaks the code, past expiry is not active), redemption (all cache keys dropped, plaintext never sent to the database, case/dash tolerant, wrong length never queries, error mapping, missing-migration message) and duplicates (listing, missing function, cache drop on merge, refusal cases).

## See also

- [docs/content/backend/student.md](../../../docs/content/backend/student.md) (student accounts)
- [src/student/README.md](../student/README.md), [src/student-portal/README.md](../student-portal/README.md), [src/auth/README.md](../auth/README.md), [src/email-domain/README.md](../email-domain/README.md) (the other way students join)
