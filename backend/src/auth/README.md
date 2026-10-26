# Auth (`src/auth`)

This module covers the HTTP side of signing in and of the signed-in user's own profile. It provides the email-code sign-in routes, `GET /api/auth/me`, onboarding (choosing a name, an account type and a school), profile edits, account deletion, sign-out and the user's avatar. It also defines the two guards the rest of the backend uses: **`AuthGuard`**, which requires a valid session cookie, and **`AdminGuard`**, which requires the caller to be an admin of their active school. The identity and session machinery underneath (users, codes, cookies) is in [`src/account`](../account/README.md). Single sign-on routes live in `src/sso`.

## What it provides

### HTTP routes

All paths start with `/api/auth`. "Public" means no guard, though the routes are still rate limited.

| Method | Path | Guard | What it does |
|--------|------|-------|--------------|
| POST | `/api/auth/otp/send` | Public. Throttled: `auth-strict` 5/hour, `auth-ip` 30/hour. | Emails an 8-digit sign-in code (body: `SendOtpDto`). Refused with a 403 when the address's school requires SSO (`EmailDomainService.ssoRequirement`). |
| POST | `/api/auth/dev/code` | Public. Hidden from Swagger. | **Dev only.** Returns `{ code }` instead of mailing it. Answers 404 unless `NODE_ENV !== 'production'` and `ALLOW_DEV_LOGIN=true`. |
| POST | `/api/auth/otp/verify` | Public. Throttled: `auth-strict` 10 per 15 min, `auth-ip` 100 per 15 min. | Verifies the code, finds or creates the `app_user` and the `user_profile`, starts a session (sets the `gb_session` cookie) and returns `{ session, user }` (`auth.verifyOtp`). `session.access_token` is always `''`, because the token lives only in the HttpOnly cookie. |
| GET | `/api/auth/me` | `AuthGuard` | The caller's profile, with `school` and `school_management` (cached as `profile:<userId>`). |
| PATCH | `/api/auth/onboard` | `AuthGuard` | Saves the name and either onboards as a student, joins the single school (on a dedicated deployment), or files a `school_join_request` when `schoolId` is given. If the user ends up with no school, it also tries `EmailDomainService.tryAutoJoin()` on the email domain. |
| POST | `/api/auth/join-school` | `AuthGuard`. Throttled: `claim-code` 10 per 15 min. | Joins a school with a school-issued code (`StudentMembershipService.joinByCode`). |
| PATCH | `/api/auth/profile` | `AuthGuard` | Updates the first and last name. |
| DELETE | `/api/auth/account` | `AuthGuard`. Throttled: `default` 3/hour. | Revokes every session (`revoked_reason = 'account_deleted'`), then deletes `user_profile` and `app_user` (cascading to sessions, identities, memberships, files, messages, ...) and writes an `account` entry to the [erasure log](../erasure/README.md), all in one transaction. After commit the user's stored files and avatar are deleted (best effort; the retention job retries). |
| POST | `/api/auth/logout` | `AuthGuard` | Revokes this device's session and clears the cookie. |
| GET | `/api/auth/sessions` | `AuthGuard` | Signed-in devices: the caller's live sessions, `[{ id, current, method, device, ip, createdAt, lastSeenAt, expiresAt }]`, the one making the request first with `current: true`. `device` is a label such as "Chrome on macOS" or "GradeBook app on iPhone 15 (iOS 19.0)". Never returns tokens or their hashes. |
| DELETE | `/api/auth/sessions/:id` | `AuthGuard` | Signs out one of the caller's sessions (`{ revoked: 1, current }`). Another user's session, or one already ended, is a 404. Revoking the current session is a logout (the cookie is cleared). |
| POST | `/api/auth/sessions/revoke-others` | `AuthGuard` | Signs out every other session of the caller (`{ revoked }`). |
| POST | `/api/auth/sessions/revoke-all` | `AuthGuard` | Signs out every session including this one and clears the cookie (`{ revoked }`). |
| GET | `/api/auth/avatar` | `AuthGuard` | Streams the caller's avatar image (`ImagesService.getImageFromUserProfile`), cached privately for an hour. |
| POST | `/api/auth/avatar` | `AuthGuard` | Multipart avatar upload (`ImagesService.setImageToUserProfile`). |
| POST | `/api/auth/avatar/resumable` | `AuthGuard` | Starts a resumable avatar upload (`CreateResumableUploadDto` from `src/images/dto`). |
| POST | `/api/auth/avatar/complete` | `AuthGuard` | Finishes a resumable upload (`CompleteUploadDto`). |

The three avatar upload routes act on the signed-in user (`req.user.id`, set by `AuthGuard`); the caller cannot name another user.

Responses go through `VersioningService.resolve()` with the `auth.*` transformers (`profile`, `verifyOtp`, `message`) and `images.*` for the uploads.

### Services / exports

- **`AuthGuard`** (exported). It resolves the session with `SessionService.resolve(req, reply)`, so a dead session clears its cookie. It then checks `user_profile.is_active`: only an explicit `false` blocks, and in that case the session is revoked and the guard answers 401. A user with no profile yet is let through, because they are still onboarding. On success it sets `req.user = { id, email, sessionId }` (`sessionId` marks "This device" in Signed-in devices). Any unexpected error becomes a 401.
- **`AdminGuard`** (not provided by the module; controllers list it in `@UseGuards` after `AuthGuard`). It allows the caller only when `user_profile.role === 'admin'`, the profile is active, it has a `school_id`, **and** there is a `school_management` row with role `admin` for that school. That membership row is the source of truth.
- **`AuthService`** (internal). Methods: `sendOtp`, `devCode`, `verifyOtp`, `getProfile`, `onboard`, `updateProfile`, `deleteAccount`. It also exports the helper `devLoginAllowed()`.

### Onboarding rules (`AuthService.onboard`)

- A student account can never onboard again as staff.
- `accountType: 'student'` saves the profile with `account_type = 'student'` and `role = null`.
- With `DEDICATED_DEPLOYMENT=true`, the user joins the one active school. An existing membership role is kept (so the school creator stays admin), and new members get `teacher` and a `school_management` row.
- A user who already has a `school_id` (because they created a school) only has their name updated.
- A `schoolId` in the request files a `school_join_request` for an admin to approve. Admin rights are never granted from a client-supplied id.

### Other

- `transformer.ts`: the v1 response shapes `v1Profile`, `v1Session`, `v1VerifyOtp` (adds `is_onboarded`, which is true when the profile has `first_name` and `school_id`) and `v1Message`, plus their interfaces. They are registered in `src/versioning/transformer-registry.ts` as `auth.profile/session/verifyOtp/message`.
- Cache key `profile:<userId>`, with a 30-day TTL. It is written on verify, onboard and profile update, and deleted on account deletion. `getProfile` ignores a cached profile that has no email, so the email can be backfilled.

## Used by

- `src/app.module.ts` imports `AuthModule`. `src/billing/billing.module.ts` imports it too, for `AuthGuard`.
- **`AuthGuard`** is used by almost every controller:
  - `academic-year`, `announcement`, `attendance`, `billing`;
  - `calendar`, `chat`, `course` (course, module, page, file and copy controllers), `course-notification`;
  - `dashboard`, `discussion`, `email-domain`, `file-manager`, `grade-scale`, `grading` (activity, assignment-group, gradebook, rubric);
  - `notifications`, `permission`, `school`, `sso`, `student-account`, `student-portal`, `student`, `term`.
- **`AdminGuard`** is used by `email-domain.controller.ts`, `grade-scale.controller.ts`, `permission.controller.ts` and `school.controller.ts`.
- `src/versioning/transformer-registry.ts` registers `auth/transformer.ts`.
- Frontend:
  - `app/login/page.tsx`, `app/login/verify/page.tsx` (`otp/send`, `otp/verify`);
  - `app/onboard/page.tsx` (`onboard`);
  - `providers/AuthProvider.tsx` and `app/onboard/pending/page.tsx` (`me`);
  - `app/dashboard/settings/page.tsx` (`me`, `profile`, `avatar`, `account`);
  - `components/auth/join-code-form.tsx` (`join-school`);
  - `components/layout/app-sidebar.tsx`, `app/portal/layout.tsx`, `app/schools/page.tsx` (`logout`).
- Mobile:
  - `app/(auth)/login.tsx`, `verify.tsx`, `onboard.tsx`;
  - `app/(tabs)/settings.tsx`;
  - `src/components/auth/JoinCodeForm.tsx`;
  - `src/providers/AuthProvider.tsx` (`me`, `logout`).
- Scripts: `backend/scripts/seed-demo.ts`, `smoke.ts` and `student-flow-check.ts` sign in through `POST /api/auth/dev/code`.

## Depends on

- `src/account`: `EmailCodeService`, `AccountService`, `SessionService` (all global).
- `PrismaService` and `CacheService` (both global).
- `EmailDomainModule`: `EmailDomainService.ssoRequirement()` and `tryAutoJoin()`.
- `StudentAccountModule`: `StudentMembershipService.joinByCode()`.
- `ImagesModule`: `ImagesService` for avatars.
- `VersioningService`.
- The named throttlers (`auth-strict`, `auth-ip`, `claim-code`, `default`), which are configured in `src/app.module.ts`.

## Data

- `public.user_profile`: read, created, upserted, updated and deleted. It is read together with its active school (`school_user_profile_school_idToschool`) and its `school_management` rows.
- `public.school`: read (the single active school on dedicated deployments).
- `public.school_management`: read (`AdminGuard`, onboarding) and created (dedicated onboarding).
- `public.school_join_request`: created.
- `account.app_user`: read (email backfill) and deleted. The session and identity tables are written through `src/account`.

Schemas: [`prisma/schema/school.prisma`](../../prisma/schema/school.prisma) and [`prisma/schema/account.prisma`](../../prisma/schema/account.prisma).

## Configuration

| Variable | Default | Used for |
|----------|---------|----------|
| `ALLOW_DEV_LOGIN` | unset (off) | Set to `true` outside production to enable `POST /api/auth/dev/code`. |
| `NODE_ENV` | | `production` always disables the dev code route. |
| `DEDICATED_DEPLOYMENT` | unset | Set to `true` to auto-join staff to the single active school on onboarding. |

`AUTH_SECRET` and the cookie settings are read in `src/account`.

## Files

| File | Purpose |
|------|---------|
| `auth.module.ts` | Imports `ImagesModule`, `StudentAccountModule` and `EmailDomainModule`. Provides `AuthService` and `AuthGuard`, and exports `AuthGuard`. |
| `auth.controller.ts` | The `/api/auth/*` routes above. |
| `auth.service.ts` | Sign-in, profile, onboarding and account deletion logic, plus `devLoginAllowed()`. |
| `auth.guard.ts` | `AuthGuard`: session and active-profile check. |
| `admin.guard.ts` | `AdminGuard`: school admin check. |
| `transformer.ts` | Versioned response shapes. |
| `dto/` | Request bodies. See [dto/README.md](./dto/README.md). |
| `auth.service.test.ts` | Tests for `AuthService`. |
| `auth.guard.test.ts` | Tests for `AuthGuard`. |

## Tests

```bash
cd backend && bun test src/auth
```

`auth.service.test.ts` covers:

- **sendOtp**: success, a mail failure, the 429 rate limit, and refusal when SSO is required.
- **devCode**: the code is returned only when allowed and never in production.
- **verifyOtp**: the session is created and the response has the expected shape; a wrong code gives a 401; a new profile gets the email; an existing profile without an email is backfilled.
- **getProfile**: cache hit and miss; a single `school_management` row collapses to an object; the email is backfilled.
- **onboard**: joining a school never grants admin; dedicated deployments auto-join and keep the creator's role.
- **updateProfile** and **deleteAccount**.

`auth.guard.test.ts` covers active, deactivated and brand-new users, a missing `is_active` field, no session, and how errors are mapped.

## See also

- [docs/content/backend/auth.md](../../../docs/content/backend/auth.md)
- [Account module](../account/README.md)
- `src/sso/`, `src/email-domain/`, `src/student-account/`
