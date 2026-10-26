# Student account (`src/student-account`)

Everything that binds a login to a school **as a student**. A school has at most one live **join code** (12 characters from an alphabet without look-alike glyphs, shown as `ABCD-EFGH-JKMN`). Staff issue it and hand it out; a student who signed up and onboarded as a student redeems it, which creates their `student.student` record in that school and links it to their profile. Staff never add students: apart from auto-join through a verified student email domain (`src/email-domain`), this is the only way a student record is created, so there is no roster record for a join to duplicate.

`StudentMembershipService` is deliberately the only code that writes student membership. Every write ends in `finalise()`, which drops the three cache entries that would otherwise keep showing stale state for up to 30 days: `profile:<userId>`, `student-context:<userId>` and `students:<schoolId>`.

Codes are stored only as an HMAC-SHA256 keyed with `STUDENT_CLAIM_CODE_PEPPER`, never in plain text; the plaintext is returned once, when issued. Redemption is a Postgres function, `public.redeem_school_join_code` (in [`prisma/migrations/0_baseline`](../../prisma/migrations/0_baseline/migration.sql)), called with `$queryRaw`.

## What it provides

### HTTP routes

`SchoolJoinCodeController` uses `@UseGuards(AuthGuard, PermissionGuard)`. Viewing status is gated on `join-code:read`; issuing and revoking are gated on `join-code:update`.

| Method | Path | Guard / who may call | What it does |
| --- | --- | --- | --- |
| GET | `/api/schools/join-code` | `join-code:read` | `{ activeCode: { expiresAt, issuedAt } \| null, expired }`. Never returns the code. |
| POST | `/api/schools/join-code` | `join-code:update` | Issue (or reissue) the code; body `IssueClaimCodeDto` (`ttlDays`, default 14, max 90). Deletes any live code and inserts the new one in one transaction. Returns `{ code, expiresAt }` - the only time the code is visible. |
| DELETE | `/api/schools/join-code` | `join-code:update` | Revoke the live code; 204. |

Redeeming the code is **not** a route here: it is `POST /api/auth/join-school` in `src/auth/auth.controller.ts` (throttled by the `claim-code` throttler, 10 per 15 min), which calls `StudentMembershipService.joinByCode()`.

### Services / exports

- `StudentMembershipService` (exported):
  - `issueCode(actorUserId, ttlDays?)`, `revokeCode(actorUserId)`, `getCodeStatus(actorUserId)` - scoped to the actor's active school.
  - `joinByCode(userId, rawCode)` - normalises case and dashes, rejects a wrong length without a database call, calls `public.redeem_school_join_code(user, hash)`, and maps its errors: `already_in_a_school` -> 409, `profile_not_found` -> 400 "Complete your profile first", `invalid_join_code` -> 400 (the same message as a wrong-length code). The code is **not** consumed; it stays valid for other students until it expires or is revoked. Returns `{ studentId, schoolId }`.
  - A missing database function (Postgres `42883`) produces an error telling you to apply the pending migrations.

## Used by

- `src/app.module.ts` imports `StudentAccountModule`.
- `src/auth/auth.module.ts` imports it, and `src/auth/auth.controller.ts` injects `StudentMembershipService` for `POST /api/auth/join-school`.
- Web: `frontend/app/dashboard/students/_components/SchoolJoinCodeDialog.tsx` (status, issue, revoke); students redeem through `frontend/components/auth/join-code-form.tsx` (shown on `frontend/app/schools/page.tsx`), which posts to `/auth/join-school`.
- Mobile: `mobile/src/components/auth/JoinCodeForm.tsx` posts to `/auth/join-school`.
- `scripts/student-flow-check.ts` exercises issue, status, redeem (`/auth/join-school`) and revoke end to end over HTTP; see [scripts/README.md](../../scripts/README.md).

## Depends on

- `PrismaService`, `CacheService` (global).
- `isoDate()`, `pgCode()`, `raisedMessage()` from `src/common/db-values.ts`.
- `AuthGuard`, `PermissionGuard`, `@RequirePermission`.

## Data

- `student.school_join_code` - created, deleted, read ([`student.prisma`](../../prisma/schema/student.prisma)). One live code per school is a database constraint.
- `public.user_profile` - read for the actor's school.
- `student.student` - created inside `public.redeem_school_join_code`.
- SQL function: `public.redeem_school_join_code`. The duplicate-merge functions were dropped by `20261027140000_drop_student_merge`.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `STUDENT_CLAIM_CODE_PEPPER` | dev-only fallback pepper | HMAC key for stored codes. **Required in production** - the service throws at startup without it. Changing it invalidates every unredeemed code. |
| `NODE_ENV` | - | `production` makes the pepper mandatory. |

## Files

| File | Purpose |
| --- | --- |
| `student-account.module.ts` | Declares `SchoolJoinCodeController`, provides and exports `StudentMembershipService`. |
| `school-join-code.controller.ts` | `SchoolJoinCodeController` (`/schools/join-code`). |
| `student-membership.service.ts` | Codes, redemption, cache invalidation. |
| `dto/` | `IssueClaimCodeDto` - see [dto/README.md](./dto/README.md). |
| `student-membership.service.test.ts` | Unit tests. |

## Tests

```bash
cd backend && bun test src/student-account
```

Covers issuing (grouped code, only the hash stored, reissue is atomic, expiry range), status (never leaks the code, past expiry is not active), redemption (all cache keys dropped, plaintext never sent to the database, case/dash tolerant, wrong length never queries, error mapping, missing-migration message).

## See also

- [docs/content/backend/student.md](../../../docs/content/backend/student.md) (student accounts)
- [src/student/README.md](../student/README.md), [src/student-portal/README.md](../student-portal/README.md), [src/auth/README.md](../auth/README.md), [src/email-domain/README.md](../email-domain/README.md) (the other way students join)
