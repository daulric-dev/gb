# Organisation (`src/organisation`)

Each GradeBook install is self-hosted by **one organisation**, which may run several schools. This module holds that organisation: the first-run setup that names it, its **organisation admins**, and the routes they use to create schools, appoint each school's admin, and sign a user out everywhere. Running a school day to day (staff, roles, settings) stays with the school's own admin in [`src/school`](../school/README.md) and [`src/permission`](../permission/README.md); an organisation admin is not made a member of the schools they create.

Organisation admins are nonetheless **administrators of every school**: `computeEffectivePermissions` ([`src/permission`](../permission/README.md)) gives them the full catalog in any school without a membership, `AdminGuard` ([`src/auth`](../auth/README.md)) lets them through for their active school, and `CourseAccessService` makes them course admin everywhere. A school's upload limit, logo and features they configure from the console without switching into it (the `/api/organisation/schools/:id/*` routes below, which call the same services as the school's own `/api/schools/current/*` routes); their email domains and sign-in from the console too (`/api/organisation/schools/:id/email-domains*`, and the providers for every school under `/api/organisation/sign-in/*`); for everything else (students, staff, calendar, grade scales, roles) they switch their active school to it (`PUT /api/me/active-school`, in `src/auth`) and use the school's own dashboard, which the web console's "Open school dashboard" action does. They are not members, so they stay out of the school's staff list, counts and chat directory.

An **organisation admin** is a signed-in user with a row in `public.organisation_admin`, or whose verified, enabled account email is listed in `ORG_ADMIN_EMAILS`. `org-admin.ts` decides it, for `OrganisationAdminGuard` and for the profile's `is_org_admin` (`GET /api/auth/me`, [`src/auth`](../auth/README.md)), so both agree.

## What it provides

### HTTP routes

| Method | Path | Guard | What it does |
| --- | --- | --- | --- |
| GET | `/api/setup/status` | Public | `{ needsSetup }`: true while no organisation exists. Clients ask before sign-in. |
| GET | `/api/setup/eligibility` | `AuthGuard` | `{ needsSetup, canSetUp }`: whether setup is pending and whether this user may run it (the same rule as `POST /api/setup`). The web app sends every signed-in user with `canSetUp` to `/setup` from each entry point; others see a "not set up yet" notice on `/setup`. |
| POST | `/api/setup` | `AuthGuard` | Body `{ organisationName }` (1-120 characters, trimmed). Creates the organisation and makes the caller its first admin in one transaction, under an advisory lock, with the `organisation_singleton` index as the backstop: 409 when it already exists (a lost race too). Who may: with `ORG_ADMIN_EMAILS` set, only a listed verified email; otherwise, on an install with no schools, the first signed-in user; on an install that already has schools (an upgrade), only someone who owns or administers one (or a listed email); anyone else gets 403 "Only a school administrator on this server, or an email listed in ORG_ADMIN_EMAILS, can finish setting up GradeBook. Sign in as one, or add your email to ORG_ADMIN_EMAILS and restart the server." Clears every cached profile. Returns `{ id, name, createdAt }`. |
| GET | `/api/organisation` | `AuthGuard`, `OrganisationAdminGuard` | `{ id, name, createdAt }`; 404 before setup. |
| PATCH | `/api/organisation` | same | Body `{ name }`. Renames it and clears every cached profile (`profile:` prefix). |
| GET | `/api/organisation/overview` | same | `{ schools, activeSchools, staff, students }`: staff are staff profiles with at least one membership; students are roster records in a school. |
| GET | `/api/organisation/admins` | same | `[{ userId, email, name, createdAt, fromEnv }]`: rows in `organisation_admin`, plus accounts listed in `ORG_ADMIN_EMAILS` (verified, enabled), with `fromEnv: true` for any listed account. |
| POST | `/api/organisation/admins` | same | Body `{ email }`. An existing account becomes an admin (and the email's open organisation admin invite is revoked): returns the admin's row with `invited: null`. With no account for the email, sends an invite instead (see [Invites](#invites)) and returns `{ invited: { id, email, expiresAt } }`. Pending ones are listed by `GET /api/organisation/invites?kind=organisation_admin`, not by `GET /admins`. |
| DELETE | `/api/organisation/admins/:userId` | same | Removes the row. 400 when it is the last admin from the database (env-listed admins do not count), with its own message when that is you; 400 for an admin who is only in `ORG_ADMIN_EMAILS` (edit the env instead); 404 for someone who is not an admin. A removed admin whose active school was one they only managed (no membership) moves to one of their memberships, or to none; their `profile:` and `perm:eff:` caches are dropped (as on add). |
| GET | `/api/organisation/schools?search=&status=` | same | `[{ id, name, code, schoolType, isActive, createdAt, admin: { userId, email, name } \| null, staffCount, studentCount, pendingAdminInvite: { id, email, expiresAt } \| null }]`, by name. `pendingAdminInvite` is the school's open admin invite (expired ones too, so they can be resent), only while it has no admin. `search` matches name or code; `status` is `active`, `inactive` or `all` (default). A null `is_active` counts as active. |
| POST | `/api/organisation/schools` | same | Body `{ name, code?, schoolType?, adminEmail? }`. Creates the school (the `seed_school_system_roles` trigger seeds its system roles); the caller does not become a member. With `adminEmail`, appoints or invites them exactly as `PUT /schools/:id/admin`. Returns the school row plus `invited` (as below). |
| GET | `/api/organisation/schools/:id` | same | One school's row (the list shape) plus `logoUrl` (null without a logo); 404 for an unknown school. |
| PATCH | `/api/organisation/schools/:id` | same | Body `{ name?, code?, schoolType?, isActive? }`. Drops `schools:all` and the members' cached profiles. |
| PUT | `/api/organisation/schools/:id/admin` | same | Body `{ email }`. With no account for the email, sends a `school_admin` invite instead (revoking the school's other open one) and returns the row with `invited: { id, email, expiresAt }`. Otherwise the account (400 for a student account) becomes the school's admin and owner (`school.owner_id`), the school's open admin invite is revoked, and `invited` is null. A school has one admin (partial unique index), so the previous admin is demoted to `teacher` first. `user_profile.role` is mirrored only where the school is that user's active school (the rule `PermissionService.changeMemberRole` follows); a user with no active school gets this one. Drops both users' `profile:` and `perm:eff:<user>:<school>` cache entries. |
| GET / PATCH | `/api/organisation/schools/:id/upload-limit` | same | That school's upload limit: the same body (`UpdateUploadLimitDto`), response (`school.uploadLimit` transformer), rules and caching as `/api/schools/current/upload-limit` (`UploadLimitService`). 404 for an unknown school. |
| POST | `/api/organisation/schools/:id/logo/upload-ticket` | same | As `/api/schools/current/logo/upload-ticket` for that school (`SchoolLogoService`). 404 for an unknown school. |
| POST | `/api/organisation/schools/:id/logo/complete` | same | As `/api/schools/current/logo/complete` (the key must be that school's staging key); drops the members' cached profiles. Returns `{ logoUrl }`. |
| DELETE | `/api/organisation/schools/:id/logo` | same | As `/api/schools/current/logo`. Returns `{ logoUrl: null }`. |
| GET / PATCH | `/api/organisation/schools/:id/features` | same | That school's features: the same shapes and rules as `/api/schools/current/features` (`FeatureService.schoolFeatures` / `updateSchoolFeatures`; switching on one the organisation does not allow is a 400). 404 for an unknown school. |
| GET | `/api/organisation/features` | same | Platform features: `[{ key, label, description, enabled, default, requires }]`, `enabled` being the organisation's own setting. From [`src/features`](../features/README.md). |
| PATCH | `/api/organisation/features` | same | Body `{ features: { [key]: boolean } }` (`UpdateFeaturesDto`). Merges into `organisation.features`; 400 for an unknown key or a non-boolean. Clears the feature cache and every cached profile. Returns the same list. |
| GET | `/api/organisation/invites?kind=` | same | Open invites (not accepted or revoked; expired ones included with `expired: true`), newest first: `[{ id, kind, email, school: { id, name } \| null, invitedBy: { userId, email, name } \| null, createdAt, expiresAt, expired }]`. `kind` (`school_admin` or `organisation_admin`) narrows it; another value is a 400. |
| DELETE | `/api/organisation/invites/:id` | same | Revokes an open invite: `{ revoked: true }`; 404 once it is accepted or revoked. |
| POST | `/api/organisation/invites/:id/resend` | same | Gives an open invite (expired or not) a fresh 14 days and emails it again: `{ id, email, expiresAt }`; 404 once it is accepted or revoked. |
| POST | `/api/organisation/users/:userId/sessions/revoke` | same | Signs a user out of every device (`SessionService.revokeAll(userId, 'organisation_admin')`); `{ revoked }`, 404 for an unknown user. |
| GET | `/api/organisation/sign-in/providers` | same | Every registered sign-in provider: `[{ key, label, kind, enabled, enabledSource, available, needsClient, clientId, clientIdSource, hasSecret, secretSource, secretUnreadable, settings, settingFields, redirectUri, saml: { metadataUrl, acsUrl, entityId } \| null, notes, updatedAt }]`. Never a secret: `hasSecret` and `secretSource` (`database`, `env` or null) only. `available` = enabled with complete credentials. `redirectUri` is what to register at Google/Microsoft. From `SignInSettingsService` (`sign-in.service.ts`) over `src/sso`. |
| PUT | `/api/organisation/sign-in/providers/:key` | same | Body `{ enabled?, clientId?, clientSecret?, settings? }` (`UpdateSignInProviderDto`). The secret is write-only and stored encrypted (AES-256-GCM, key derived from `AUTH_SECRET`); an empty `clientId`/`clientSecret` clears the saved value so the env applies again; a `settings` value of null or "" removes it. 404 for an unknown key; 400 for an empty body, a client ID with spaces, credentials on SAML, an unknown or invalid setting, or turning on (or leaving on) a provider without a complete client ID and secret. Applies at once on this instance, within 30 s on others. Returns the item. |
| GET | `/api/organisation/sign-in/domains` | same | Every school's email domains (`EmailDomainService.listAll`): the school admin's domain shape plus `schoolId`, `schoolName`, by school then domain. |
| GET / POST | `/api/organisation/schools/:id/email-domains` | same | That school's domains, or add one: the same bodies, responses and rules as `/api/schools/email-domains` (`EmailDomainService.listForSchool` / `addToSchool`, the organisation admin recorded as creator). 404 for an unknown school. |
| PATCH / DELETE | `/api/organisation/schools/:id/email-domains/:domainId` | same | As `/api/schools/email-domains/:id` (`updateInSchool` / `removeFromSchool`): SSO provider, requirement, tenant and SAML settings with the same validation. 404 for an unknown school or a domain of another school. |
| POST | `/api/organisation/schools/:id/email-domains/:domainId/verify` | same | As `/api/schools/email-domains/:id/verify` (`verifyInSchool`), with the same throttle. |

There is no `POST /api/schools`: this module is the only way to create a school.

### Invites

Appointing a school's admin, or adding an organisation admin, by an email no account uses yet sends an invite (`public.organisation_invite`, 14 days) instead of failing. Rules:

- A school has one admin, so it has at most one open `school_admin` invite: a new one revokes the previous one, and appointing an existing account revokes it (`seatSchoolAdmin`). An email has at most one open `organisation_admin` invite (a new one replaces it; adding the account directly revokes it). Partial unique indexes back both.
- **Acceptance.** `InviteService` registers a hook with `AccountService.onVerifiedSignIn` at boot. It runs inside `AccountService.userForVerifiedEmail` after the account is found or created, which is every sign-in that proves the email: an email code (`AuthService.verifyOtp`), and an SSO sign-in whose provider vouches for the address when it is first linked (`userForIdentity` with `emailTrusted`). An unverified SSO address never reaches it. In one transaction it creates the profile if this is the first sign-in, claims each open, unexpired invite for the email (conditional update, so concurrent sign-ins apply it once) and applies it: `school_admin` seats them through `seatSchoolAdmin` (the same code as `appointAdmin`: previous admin demoted to teacher, owner set, active school set if none), `organisation_admin` adds their `organisation_admin` row (`created_by` = the inviter). Marked `accepted_at` / `accepted_by`. Caches: `profile:` and `perm:eff:` for them and any demoted admin, `schools:all`. A student account is never seated: that invite stays open and is logged. A failure is logged and the sign-in carries on.
- **Email.** With SMTP configured (`MailService`), the invite and every resend email "You've been invited to run <School> on GradeBook" / "...to administer <Organisation> on GradeBook" (`invite.email.ts`, the account email layout, escaped) with a button to `<first FRONTEND_URL origin>/login`. Without SMTP it is skipped and logged; a send failure is only logged.

### Services / exports

- `OrganisationService` (exported): `status`, `setup`, `get`, `rename`, `overview`, `admins`, `addAdmin`, `removeAdmin`, `schools`, `school` (one row plus `logoUrl`), `requireSchool` (404 for an unknown school), `createSchool`, `updateSchool`, `appointAdmin`, `revokeUserSessions`.
- `InviteService` (exported): `invite`, `list`, `revoke`, `resend`, `pendingForSchools`, `revokeOrganisationAdminInvite`, `acceptFor` (the verified sign-in hook).
- `school-admin.ts`: `seatSchoolAdmin(tx, user, schoolId)`, the appointment both `appointAdmin` and invite acceptance run.
- `OrganisationAdminGuard`: 403 "Organisation admin access required" unless the caller is an organisation admin; a lookup failure fails closed. Use it after `AuthGuard`.
- `org-admin.ts` (plain functions, so `src/auth` can use them without a module cycle): `orgAdminEmails()`, `isEnvOrgAdmin(prisma, userId)`, `isOrgAdmin(prisma, userId)`, `organisationSummary(prisma)`.

## Used by

- `src/app.module.ts` imports `OrganisationModule`.
- `src/auth/auth.service.ts` uses `org-admin.ts` for the profile's `is_org_admin` and `organisation`.
- Web: the organisation console `frontend/app/organisation/*`; `schools/page.tsx` lists schools (the name links to the school's page), `schools/[schoolId]/page.tsx` is one school's page (details, admin, and the dashboard's upload-limit, logo and features cards and its single sign-on section - the email-domain components - with `apiBase` `/organisation/schools/<id>`), with the dialogs and actions both share in `schools/_components/`; `settings/_components/sign-in-apps.tsx` (Settings > Sign-in apps) calls the provider routes; the overview's `_components/school-domains.tsx` calls `GET /sign-in/domains`.
- Scripts: `scripts/seed-demo.ts` creates the organisation (if none) and makes `admin@demo.test` an organisation admin; `scripts/smoke.ts` checks the routes.

## Depends on

- `PrismaService`, `CacheService`, `SessionService`, `AccountService`, `MailService` (global).
- `FeatureService` (global, `src/features`) for the features routes.
- `UploadLimitService` (`FileManagerModule`), `SchoolLogoService` (`SchoolModule`) and `VersioningService` (global) for the per-school settings routes.
- `EmailDomainService` (`EmailDomainModule`), `SsoRegistry` and `SsoSettingsService` (global `SsoCoreModule`) for the sign-in routes.
- `AuthGuard` (`AuthModule`), `permCacheKey` from `src/permission/permission.effective.ts`, `normalizeEmail` from `src/account`, `isUniqueViolation` from `src/common/db-values.ts`.

## Data

Tables in [`prisma/schema/organisation.prisma`](../../prisma/schema/organisation.prisma) (Postgres schema `public`; migration `20261102100000_organisation`):

- `organisation` - one row (`organisation_singleton` unique index on a constant). Its `features` jsonb (migration `20261102120000_features`) holds the platform feature overrides, managed by `src/features`.
- `organisation_admin` - one row per admin, keyed by `user_id` (cascades with the profile); `created_by` is set null when that admin goes.
- `organisation_invite` (migration `20261103110000_invites`) - invites for emails without an account: `email` (lower-cased), `kind` (`school_admin` with `school_id`, cascading with the school; or `organisation_admin`), `invited_by`, `created_at`, `expires_at` (+14 days), `accepted_at` / `accepted_by`, `revoked_at`. See [Invites](#invites).

Also reads `school`, `school_management`, `student`, `user_profile` and `app_user`; writes `school` (create, update, `owner_id`), `school_management` (appoint, demote) and `user_profile` (`school_id` / `role` mirror).

Cache keys: deletes `profile:<userId>` (admin added or removed, appointments, school changes), the whole `profile:` prefix (setup, rename), `perm:eff:<userId>:<schoolId>` (appointments) and `schools:all` (school created or changed).

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `ORG_ADMIN_EMAILS` | unset | Comma-separated emails. A signed-in account with a verified, listed email is an organisation admin without a row; while set, only those accounts may run the first-run setup. |

## Files

| File | Purpose |
| --- | --- |
| `organisation.module.ts` | Declares the controllers, the services and the guard; imports `FileManagerModule` and `SchoolModule` for the per-school settings routes and `EmailDomainModule` for the sign-in ones. |
| `organisation.controller.ts` | `SetupController` (`/setup`) and `OrganisationController` (`/organisation`). |
| `sign-in.controller.ts` | `SignInController` (`/organisation/sign-in/*`, `/organisation/schools/:id/email-domains*`). |
| `sign-in.service.ts` | `SignInSettingsService`: the provider list and saving a provider's settings. |
| `sign-in.dto.ts` | `UpdateSignInProviderDto`. |
| `sign-in.test.ts` | Sign-in routes: guards and route table, 403 for non-admins, 404 for an unknown school or provider, school id passed through, secrets never returned, DB over env, disabling, per-provider validation. |
| `organisation.service.ts` | Setup, admins, schools, appointments, session revocation. |
| `organisation-admin.guard.ts` | `OrganisationAdminGuard`. |
| `org-admin.ts` | Who is an organisation admin; the organisation summary for profiles. |
| `invite.controller.ts` | `InviteController` (`/organisation/invites`). |
| `invite.service.ts` | `InviteService`: sending, listing, revoking, resending and accepting invites. |
| `invite.email.ts` | The invite email. |
| `school-admin.ts` | `seatSchoolAdmin`, shared by appointing and accepting. |
| `dto/organisation.dto.ts` | `SetupDto`, `UpdateOrganisationDto`, `AdminEmailDto`, `CreateOrganisationSchoolDto`, `UpdateOrganisationSchoolDto` (strings trimmed; `schoolType` is one of `SCHOOL_TYPES`: `preschool`, `primary`, `middle`, `secondary`, `all_through`, `sixth_form`, `college`, `university`, `vocational`, `special_education`, `online`, `other`). |
| `*.test.ts` | Unit tests. |

## Tests

```bash
cd backend && bun test src/organisation
```

Covers setup (first user on an empty install, a stranger refused on an install with schools, a school owner or admin allowed, the `ORG_ADMIN_EMAILS` restriction, 409 the second time, both races: the re-check under the lock and the singleton index), the guard (rows, listed verified emails, unverified or disabled accounts, failing closed), rename and cache clearing, the overview, the admins list with `fromEnv`, adding (an invite without an account) and removing (last-admin protection, env-only admins), the schools list (counts, admin, search and status filters), one school with its logo URL (404 when unknown), the per-school settings routes (guarded, 404 for an unknown school before any service runs, delegating with that school id), creating a school without making the caller a member (with and without `adminEmail`, an invite for an unknown one), updating, appointing an admin (demotion before the upsert, the profile mirror rules, cache clearing, an invite for an unknown email, revoking the school's invite when appointing an account), invites (a new school invite revokes the previous one, revoke and resend, the email with and without SMTP and escaped, acceptance on verified sign-in appointing and demoting and marking accepted, a first sign-in getting a profile, organisation admin invites, expired and revoked ignored, a student never seated, a claimed invite applied once, hooks never run for an unverified SSO email or a disabled account and never failing sign-in), session revocation, the route table and its guards, that `POST /schools` is gone and that the app module has no billing module.
