---
sidebar_label: Organisation
---

# Organisation

Each GradeBook install is self-hosted by **one organisation**, which may run several schools. The organisation is created once, by the first-run setup; its **organisation admins** create the schools, appoint each school's admin and can sign any user out. Day-to-day school management (staff, roles, settings, join requests) stays with each school's own admin.

Code: `backend/src/organisation` (see its README for the details).

## Who is an organisation admin

A signed-in user is an organisation admin when either:

- they have a row in `public.organisation_admin` (the person who ran setup, or anyone another admin added), or
- their verified, enabled account email is listed in `ORG_ADMIN_EMAILS` (comma separated) on the backend.

`GET /api/auth/me` reports it as `is_org_admin`, next to `organisation: { name } | null` and `features` (see [Platform features](./features.md)). An organisation admin does not need to belong to a school.

## First-run setup

Until an organisation exists, `GET /api/setup/status` (public) answers `{ "needsSetup": true }`. A signed-in user then calls `POST /api/setup` with `{ "organisationName": "..." }` (1-120 characters): the organisation is created and the caller becomes its first admin, together. A second setup is a `409`, including one that loses a race. Signed-in clients ask `GET /api/setup/eligibility` for `{ needsSetup, canSetUp }`; the web app sends anyone who may set up straight to `/setup` (there is no way to skip it), and shows everyone else a "not set up yet" notice there.

Who may run it:

| Install | Who |
| --- | --- |
| `ORG_ADMIN_EMAILS` set | Only a listed, verified email |
| No schools yet (a new install) | The first signed-in user |
| Schools already exist (upgrading an older install) | Someone who owns or administers one of them; anyone else gets `403` "Only a school administrator on this server, or an email listed in ORG_ADMIN_EMAILS, can finish setting up GradeBook. Sign in as one, or add your email to ORG_ADMIN_EMAILS and restart the server." |

Upgrading from the hosted platform: migration `20261102100000_organisation` turns every former platform admin (`billing.platform_admin`) into an organisation admin; the organisation itself is still created by setup.

## API

All under `/api/organisation`, behind `AuthGuard` and `OrganisationAdminGuard` (403 for everyone else).

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/organisation` | | `{ id, name, createdAt }` |
| PATCH | `/organisation` | `{ name }` | the same |
| GET | `/organisation/overview` | | `{ schools, activeSchools, staff, students }` |
| GET | `/organisation/admins` | | `[{ userId, email, name, createdAt, fromEnv }]` (accounts from `ORG_ADMIN_EMAILS` have `fromEnv: true`) |
| POST | `/organisation/admins` | `{ email }` | the new admin with `invited: null`; with no account for the email, `{ invited: { id, email, expiresAt } }` (see [Invites](#invites)) |
| DELETE | `/organisation/admins/:userId` | | `{ removed: true }`; `400` for the last admin from the database, or for an admin who is only in `ORG_ADMIN_EMAILS` |
| QUERY | `/organisation/schools` | body `{ search?, status?: active\|inactive\|all }` | `[{ id, name, code, schoolType, isActive, createdAt, admin: { userId, email, name } \| null, staffCount, studentCount, pendingAdminInvite: { id, email, expiresAt } \| null }]` |
| POST | `/organisation/schools` | `{ name, code?, schoolType?, adminEmail? }` | the school row; the caller is not made a member; `adminEmail` is appointed (or invited) as with `PUT .../admin`; plus `invited` |
| GET | `/organisation/schools/:id` | | the school row plus `logoUrl`; `404` for an unknown school |
| PATCH | `/organisation/schools/:id` | `{ name?, code?, schoolType?, isActive? }` | the school row |
| GET / PATCH | `/organisation/schools/:id/upload-limit` | PATCH: `{ maxUploadMb: number \| null }` | as `/schools/current/upload-limit`, for that school |
| POST | `/organisation/schools/:id/logo/upload-ticket` | `{ filename, contentType, totalSize }` | as `/schools/current/logo/upload-ticket` |
| POST | `/organisation/schools/:id/logo/complete` | `{ path }` | `{ logoUrl }` |
| DELETE | `/organisation/schools/:id/logo` | | `{ logoUrl: null }` |
| GET / PATCH | `/organisation/schools/:id/features` | PATCH: `{ features: { [key]: boolean } }` | as `/schools/current/features`, for that school |
| PUT | `/organisation/schools/:id/admin` | `{ email }` | the school row plus `invited: { id, email, expiresAt } \| null`: an email with no account is invited instead |
| QUERY | `/organisation/invites` | body `{ kind?: school_admin\|organisation_admin }` | open invites: `[{ id, kind, email, school, invitedBy, createdAt, expiresAt, expired }]` |
| DELETE | `/organisation/invites/:id` | | `{ revoked: true }`; `404` once accepted or revoked |
| POST | `/organisation/invites/:id/resend` | | `{ id, email, expiresAt }`: 14 more days, emailed again |
| POST | `/organisation/users/:userId/sessions/revoke` | | `{ revoked }` |
| GET | `/organisation/features` | | `[{ key, label, description, enabled, default, requires }]` |
| PATCH | `/organisation/features` | `{ features: { [key]: boolean } }` | the same list; `400` for an unknown key |
| GET | `/organisation/schools/:id/sso/providers` | | one school's providers `[{ key, label, enabled, available, configSource, clientId, hasSecret, secretSource, settings, redirectUri, saml, notes, ... }]` - never a secret; `404` for an unknown school |
| PUT | `/organisation/schools/:id/sso/providers/:key` | `{ enabled?, clientId?, clientSecret?, settings? }` (secret write-only; `""` clears) | the same item; `400` when turned on without the school's own client ID and secret, or for `saml`; `403 STEP_UP_REQUIRED` without a recent step-up (also on the email-domain writes) |
| QUERY | `/organisation/schools/:id/sso/audit` | body `{ limit?, before? }` | the school's SSO activity, newest first `[{ id, createdAt, action, domain, actor, actorVia, changes }]`; `404` for an unknown school |
| GET | `/organisation/sign-in/domains` | | every school's email domains with `schoolId`, `schoolName` |
| GET / POST | `/organisation/schools/:id/email-domains` | POST: as `/schools/email-domains` | as `/schools/email-domains`, for that school |
| PATCH / DELETE | `/organisation/schools/:id/email-domains/:domainId` | PATCH: as `/schools/email-domains/:id` | the domain / `204` |
| POST | `/organisation/schools/:id/email-domains/:domainId/verify` | | the domain |

### Platform features

The organisation switches platform features (messaging, student messaging, channels, announcements, discussions, attendance, files, calendar, course copying, push notifications) on or off for every school; a school's admin can only switch off what it allows. See [Platform features](./features.md).

### Single sign-on

Single sign-on is configured per school: each school's console page has a **Single sign-on** section (the same components as the school admin's *Settings > Single sign-on* and *Email domains* pages, with `apiBase` `/organisation/schools/<id>`). It has the school's own **Sign-in apps** - Google and Microsoft, each with an on/off switch, client ID, write-only client secret (stored encrypted, bound to the school; shown only as "Saved"), the redirect URI to copy and a status ("Not set up" by default) - and its **email domains**: add, verify, remove and, per domain, audience, auto-join, staff role, provider (only those available to the school: its own apps, the server's env fallback, or SAML with the IdP details and our SP details to copy), Microsoft tenant ID, "Require single sign-on" and a test sign-in link. The **Overview** lists every school's domains with links. The `SSO_PROVIDERS` / `GOOGLE_*` / `MICROSOFT_*` env vars are an optional install-wide fallback for schools that have not saved their own app. See [Single sign-on](../sso.md).

### Appointing a school admin

A school has exactly one admin. `PUT /organisation/schools/:id/admin` makes the account its admin and owner (`school.owner_id`) and demotes the previous admin to `teacher`. `user_profile.role` changes only where the school is that user's active school; a user with no active school gets this one. Their cached profiles and permissions are cleared, so the change applies on the next request.

### Invites

Appointing a school's admin, or adding an organisation admin, by an email nobody signs in with yet sends an **invite** (14 days) instead of failing. The first sign-in that proves that email (an email code, or an SSO provider that vouches for the address) applies it automatically: a school admin invite has the same effect as appointing (the previous admin becomes a teacher), an organisation admin invite adds the admin. A student account is never made a school's admin (the invite stays open). A school has at most one open admin invite, so a new one replaces the old, and appointing an existing account cancels it. With SMTP configured the invitee gets an email ("You've been invited to run <School> on GradeBook") linking to the sign-in page; without SMTP nothing is sent, so tell them yourself. On the web the schools list and a school's page show "Invited: email (expires …)" with Resend and Cancel, and **Administrators** lists pending invites.

`POST /api/schools` no longer exists: schools are only created here.

### Managing a school

Organisation admins are administrators of **every** school in the install, without a membership: in any school they hold the full permission catalog (`GET /api/permissions/me` reports `isAdmin: true`, `viaOrganisation: true`), pass `AdminGuard` for their active school, and are course admin in every course. The rule lives in one place, `computeEffectivePermissions` (`backend/src/permission/permission.effective.ts`). They are not members, so they do not appear in a school's staff list, staff counts or chat directory.

A school's **upload limit, logo, features and email domains** they set from the console, without switching into it: the `/organisation/schools/:id/*` routes above call the same services, with the same rules and cache clearing, as the school's own `/schools/current/*` routes (`404` for an unknown school). For everything else they make it their **active school** and use that school's own dashboard (students, staff and roles, academic calendar, grade scales, join code, announcements, settings). The same routes let anyone who works in more than one school switch between them:

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/me/schools` | | `[{ id, name, logoUrl, role, viaOrganisation, isActive }]`: the caller's memberships plus, for an organisation admin, every active school (`viaOrganisation: true` where they are not a member). Students get only their own school. |
| PUT | `/api/me/active-school` | `{ schoolId }` | the refreshed profile. Sets `user_profile.school_id` and mirrors `role` (the membership role, or `admin` for an organisation admin without one). `403` for students and for a school the caller cannot access, `400` for an inactive school. |

On the web, a school's name in **Organisation → Schools** opens its page in the console (`/organisation/schools/<id>`): its details and admin (edit, appoint admin, activate or deactivate, sign the admin out), the upload limit, logo, features and single sign-on sections, and "Open school dashboard". That action (also in each row's menu) switches and opens the school's settings; the dashboard then shows a banner "Managing <school> as organisation administrator · Back to organisation". The dashboard sidebar has a school switcher whenever more than one school is available, and the mobile app's Settings tab a "Switch school" row.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `ORG_ADMIN_EMAILS` | unset | Comma-separated emails that are organisation admins without a database row; while set, only they may run first-run setup. |
