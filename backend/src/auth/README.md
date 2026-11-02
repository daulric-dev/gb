# Auth (`src/auth`)

This module covers the HTTP side of signing in and of the signed-in user's own profile. It provides the email-code sign-in routes, `GET /api/auth/me`, onboarding (choosing a name, an account type and a school), profile edits, account deletion, sign-out and the user's avatar. It also defines the two guards the rest of the backend uses: **`AuthGuard`**, which requires a valid session cookie, and **`AdminGuard`**, which requires the caller to be an admin of their active school. The identity and session machinery underneath (users, codes, cookies) is in [`src/account`](../account/README.md). Single sign-on routes live in `src/sso`.

## What it provides

### HTTP routes

All paths start with `/api/auth`. "Public" means no guard, though the routes are still rate limited.

| Method | Path | Guard | What it does |
|--------|------|-------|--------------|
| POST | `/api/auth/otp/send` | Public. Throttled: `auth-strict` 5/hour per address + IP, `auth-ip` 300/hour. | Emails an 8-digit sign-in code (body: `SendOtpDto`). Refused with a 403 when the address's school requires SSO (`EmailDomainService.ssoRequirement`). |
| POST | `/api/auth/dev/code` | Public. Hidden from Swagger. | **Dev only.** Returns `{ code }` instead of mailing it. Answers 404 unless `NODE_ENV !== 'production'` and `ALLOW_DEV_LOGIN=true`. |
| POST | `/api/auth/otp/verify` | Public. Throttled: `auth-strict` 10 per 15 min per address + IP, `auth-ip` 600 per 15 min. | Verifies the code, finds or creates the `app_user` and the `user_profile`, starts a session (sets the `gb_session` cookie) and returns `{ session, user }` (`auth.verifyOtp`). `session.access_token` is always `''`, because the token lives only in the HttpOnly cookie. |
| GET | `/api/auth/me` | `AuthGuard` | The caller's profile, with `school` (its row plus `logo_url`, null without a logo), `school_management`, `is_org_admin` (a row in `public.organisation_admin` or a verified email in `ORG_ADMIN_EMAILS`) `organisation` (`{ name }`, null before first-run setup) and `features` (`{ [key]: boolean }`, the platform features effective for the active school, or the organisation's without one; see [`src/features`](../features/README.md)), cached as `profile:<userId>`. A cached entry without `is_org_admin` or `features` (written at sign-in, onboarding or a profile edit) is rebuilt; `src/organisation` drops entries when admins change and every entry when the organisation is set up or renamed, and `src/features` drops every entry when features change. The sign-in, onboarding and profile-edit responses carry `features` too. |
| PATCH | `/api/auth/onboard` | `AuthGuard` | Saves the name and either onboards as a student or files a `school_join_request` when `schoolId` is given. If the user ends up with no school, it also tries `EmailDomainService.tryAutoJoin()` on the email domain. |
| POST | `/api/auth/join-school` | `AuthGuard`. Throttled: `claim-code` 10 per 15 min. | Joins a school with a school-issued code (`StudentMembershipService.joinByCode`). |
| PATCH | `/api/auth/profile` | `AuthGuard` | Updates the first and last name. |
| DELETE | `/api/auth/account` | `AuthGuard`. Throttled: `default` 3/hour. | Revokes every session (`revoked_reason = 'account_deleted'`), then deletes `user_profile` and `app_user` (cascading to sessions, identities, memberships, files, messages, ...) and writes an `account` entry to the [erasure log](../erasure/README.md), all in one transaction. After commit the user's stored files and avatar are deleted (best effort; the retention job retries). |
| POST | `/api/auth/logout` | `AuthGuard` | Revokes this device's session and clears the cookie. |
| GET | `/api/auth/sessions` | `AuthGuard` | Signed-in devices: the caller's live sessions, `[{ id, current, method, device, ip, createdAt, lastSeenAt, expiresAt }]`, the one making the request first with `current: true`. `device` is a label such as "Chrome on macOS" or "GradeBook app on iPhone 15 (iOS 19.0)". Never returns tokens or their hashes. |
| DELETE | `/api/auth/sessions/:id` | `AuthGuard` | Signs out one of the caller's sessions (`{ revoked: 1, current }`). Another user's session, or one already ended, is a 404. Revoking the current session is a logout (the cookie is cleared). |
| POST | `/api/auth/sessions/revoke-others` | `AuthGuard` | Signs out every other session of the caller (`{ revoked }`). |
| POST | `/api/auth/sessions/revoke-all` | `AuthGuard` | Signs out every session including this one and clears the cookie (`{ revoked }`). |
| POST | `/api/auth/step-up/send` | `AuthGuard`. Throttled like `otp/send`. | Step-up: emails an 8-digit "Confirm it's you" code to the **session's** address (never one from the body). A `step_up`-purpose `EmailCodeService` code: same expiry and send caps as sign-in, counted separately. `{ sent: true }`. |
| POST | `/api/auth/step-up/verify` | `AuthGuard`. Throttled like `otp/verify`. | Body `{ code }` (`VerifyStepUpDto`). Checks the code (a sign-in code is refused, and a step-up code cannot sign in) with the same per-client and total attempt limits, then sets this session's `elevated_until` to now + 10 minutes and drops its cached lookup. `{ elevatedUntil }`; a wrong code is a **400** (not 401: the session is fine). |
| POST | `/api/auth/dev/step-up-code` | `AuthGuard`. Hidden from Swagger. | **Dev only**, like `dev/code`: `{ code }` for the signed-in user instead of mailing it. 404 unless `NODE_ENV !== 'production'` and `ALLOW_DEV_LOGIN=true`. |
| GET | `/api/auth/avatar` | `AuthGuard` | Streams the caller's avatar image (`ImagesService.getImageFromUserProfile`), cached privately for an hour. |
| POST | `/api/auth/avatar/resumable` | `AuthGuard` | Starts an avatar upload: a presigned PUT ticket straight to storage (`CreateResumableUploadDto` from `src/images/dto`). |
| POST | `/api/auth/avatar/complete` | `AuthGuard` | Checks the uploaded image and sets it as the avatar (`CompleteUploadDto`). |

#### The caller's schools (`me.controller.ts`, `ActiveSchoolService`)

| Method | Path | Guard | What it does |
|--------|------|-------|--------------|
| GET | `/api/me/schools` | `AuthGuard` | Schools the caller can work in: `[{ id, name, logoUrl, role, viaOrganisation, isActive }]`, sorted by name. Staff get their memberships (`role` is the membership role) plus, for an organisation admin, every active school (`viaOrganisation: true`, `role: null` where they have no membership). Students get only their own school. Inactive schools are left out unless one is the active school. |
| PUT | `/api/me/active-school` | `AuthGuard` | Body `{ schoolId }` (`SetActiveSchoolDto`, UUID). Sets `user_profile.school_id` and mirrors `user_profile.role`: the membership role there, or `'admin'` for an organisation admin without one. Students get 403, a school the caller has no membership in (and is not an organisation admin for) 403, an inactive school 400. Drops `profile:<userId>` and every `perm:eff:<userId>:*`, then returns the refreshed profile (`auth.profile`). |

The web dashboard (sidebar school switcher, "Open school dashboard" in the organisation console) and the mobile Settings tab ("Switch school") call these.

Avatar bytes never pass through the API: the client PUTs them to the presigned URL between these two calls. Both upload routes act on the signed-in user (`req.user.id`, set by `AuthGuard`); the caller cannot name another user.

Responses go through `VersioningService.resolve()` with the `auth.*` transformers (`profile`, `verifyOtp`, `message`) and `images.*` for the uploads.

### Services / exports

- **`AuthGuard`** (exported). It resolves the session with `SessionService.resolve(req, reply)`, so a dead session clears its cookie. It then checks `user_profile.is_active`: only an explicit `false` blocks, and in that case the session is revoked and the guard answers 401. A user with no profile yet is let through, because they are still onboarding. On success it sets `req.user = { id, email, sessionId, elevatedUntil }` (`sessionId` marks "This device" in Signed-in devices; `elevatedUntil` is the step-up window, ms or null). Any unexpected error becomes a 401.
- **`AdminGuard`** (not provided by the module; controllers list it in `@UseGuards` after `AuthGuard`). It allows the caller only when `user_profile.role === 'admin'`, the profile is active, it has a `school_id`, **and** there is a `school_management` row with role `admin` for that school. That membership row is the source of truth. An **organisation admin** (`isOrgAdmin` from `src/organisation/org-admin.ts`) with an active profile and an active school passes too, with or without a membership: they administer every school in the install.
- **`@RequireStepUp()` / `StepUpGuard`** (`step-up.guard.ts`). For routes that change single sign-on settings: after the route's own guards (who may act is decided first), 403 `{ statusCode: 403, code: 'STEP_UP_REQUIRED', message: "Confirm it's you to change single sign-on settings." }` unless `req.user.elevatedUntil` is in the future. On every email-domain write and sign-in app `PUT`, in both the school admin's and the organisation console's routes; never on reads. The web app's `api(path, { stepUp: true })` opens the "Confirm it's you" dialog on that code and retries.
- **`StepUpService`** (internal). `send`, `verify`, `devCode` behind `step-up.controller.ts`.
- **`ActiveSchoolService`** (internal). `list(userId)` and `switch(userId, schoolId)` behind the `/api/me` routes above.
- **`AuthService`** (internal). Methods: `sendOtp`, `devCode`, `verifyOtp`, `getProfile`, `onboard`, `updateProfile`, `deleteAccount`. It also exports the helper `devLoginAllowed()`.

### Onboarding rules (`AuthService.onboard`)

- A student account can never onboard again as staff.
- `accountType: 'student'` saves the profile with `account_type = 'student'` and `role = null`.
- A user who already has a `school_id` (because they created a school) only has their name updated.
- A `schoolId` in the request files a `school_join_request` for an admin to approve. Admin rights are never granted from a client-supplied id.

### Other

- `transformer.ts`: the v1 response shapes `v1Profile`, `v1Session`, `v1VerifyOtp` (adds `is_onboarded`, which is true when the profile has `first_name` and `school_id`) and `v1Message`, plus their interfaces. They are registered in `src/versioning/transformer-registry.ts` as `auth.profile/session/verifyOtp/message`.
- Cache key `profile:<userId>`, with a 30-day TTL. It is written on verify, onboard and profile update, and deleted on account deletion, on switching the active school and by `src/organisation` (admin added or removed, school appointed, setup or rename). `getProfile` ignores a cached profile that has no email, so the email can be backfilled.

## Used by

- `src/app.module.ts` imports `AuthModule`. `src/organisation/organisation.module.ts` imports it too, for `AuthGuard`.
- **`AuthGuard`** is used by almost every controller:
  - `academic-year`, `announcement`, `attendance`;
  - `calendar`, `chat`, `course` (course, module, page, file and copy controllers), `course-notification`;
  - `dashboard`, `discussion`, `email-domain`, `file-manager`, `grade-scale`, `grading` (activity, assignment-group, gradebook, rubric);
  - `notifications`, `organisation`, `permission`, `school`, `sso`, `student-account`, `student-portal`, `student`, `term`.
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
- `public.school_management`: read (`AdminGuard`, `getProfile`).
- `public.organisation`, `public.organisation_admin`: read for the profile's `organisation` and `is_org_admin` (through `src/organisation/org-admin.ts`).
- `public.organisation.features`, `public.school.disabled_features`: read through `FeatureService` (`src/features`) for the profile's `features`.
- `public.school_join_request`: created.
- `account.app_user`: read (email backfill) and deleted. The session and identity tables are written through `src/account`.

Schemas: [`prisma/schema/school.prisma`](../../prisma/schema/school.prisma) and [`prisma/schema/account.prisma`](../../prisma/schema/account.prisma).

## Configuration

| Variable | Default | Used for |
|----------|---------|----------|
| `ALLOW_DEV_LOGIN` | unset (off) | Set to `true` outside production to enable `POST /api/auth/dev/code` and `POST /api/auth/dev/step-up-code`. |
| `NODE_ENV` | | `production` always disables the dev code route. |
| `ORG_ADMIN_EMAILS` | unset | Read through `src/organisation/org-admin.ts`: a listed, verified email makes the profile's `is_org_admin` true. |

`AUTH_SECRET` and the cookie settings are read in `src/account`.

## Files

| File | Purpose |
|------|---------|
| `auth.module.ts` | Imports `ImagesModule`, `StudentAccountModule` and `EmailDomainModule`. Provides `AuthService`, `AuthGuard`, `ActiveSchoolService` and `StepUpService`, and exports `AuthGuard`. |
| `auth.controller.ts` | The `/api/auth/*` routes above. |
| `auth.service.ts` | Sign-in, profile, onboarding and account deletion logic, plus `devLoginAllowed()`. |
| `auth.guard.ts` | `AuthGuard`: session and active-profile check. |
| `admin.guard.ts` | `AdminGuard`: school admin check. |
| `step-up.guard.ts` | `StepUpGuard`, `@RequireStepUp()`, `STEP_UP_REQUIRED`. |
| `step-up.service.ts`, `step-up.controller.ts` | The step-up routes above. |
| `step-up.test.ts` | Guard 403 shape and window expiry, placement on every SSO write route (both consoles) and not on reads, send/verify use the `step_up` purpose and elevate only this session, wrong code elevates nothing, dev route dev-only. Purpose separation, attempt limits and the session cache are tested in `src/account/account.test.ts`. |
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
- **getProfile**: cache hit and miss; a single `school_management` row collapses to an object; the email is backfilled; `is_org_admin`, `organisation` and `features` (effective for the active school) are added, and a cached profile without them is rebuilt.
- **onboard**: joining a school never grants admin.
- **updateProfile** and **deleteAccount**.

`auth.guard.test.ts` covers active, deactivated and brand-new users, a missing `is_active` field, no session, and how errors are mapped.

## See also

- [docs/content/backend/auth.md](../../../docs/content/backend/auth.md)
- [Account module](../account/README.md)
- `src/sso/`, `src/email-domain/`, `src/student-account/`
