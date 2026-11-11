# Email domains (`src/email-domain`)

A school can claim the email domains it owns (for example `students.riverside.edu`) and then people who sign in with an address at that domain are put into the school automatically, or, for staff on an approval domain, a join request is filed for the admin. The school proves ownership by publishing a DNS TXT record; signing in with an emailed code proves the person controls the address. Only when both hold does an address put someone in a school. Each domain also carries the school's single sign-on settings (provider, Microsoft tenant, SAML connection, and whether SSO is required for that domain), which the auth and SSO modules read during sign-in.

## What it provides

### HTTP routes

School admin side, `EmailDomainController`: `AuthGuard` + `AdminGuard` (an active profile with role `admin` and an `admin` membership in their current school). Domains are always scoped to the admin's school; another school's id is a `404`.

Every write (`POST`, `PATCH`, `DELETE`, `verify`) - here and in the organisation console - needs a recent **step-up** confirmation (`@RequireStepUp()`, 403 `{ code: 'STEP_UP_REQUIRED' }` otherwise; see [src/auth/README.md](../auth/README.md)), and is written to `public.sso_audit_log` in the same transaction as the change (`domain_added`, `domain_removed`, `domain_verified`, and per group of fields an update really changed: `domain_settings_changed`, `provider_changed`, `sso_required_changed`, `azure_tenant_changed`, `saml_changed` - certificates as SHA-256 fingerprints). After the commit, a change to the provider, Microsoft tenant or SAML connection, or Require SSO turned off, emails the school's admins (`SsoAlertService`). See [src/sso/README.md](../sso/README.md).

| Method | Path | What it does |
|--------|------|--------------|
| GET | `/api/schools/email-domains` | The school's domains, sorted by name, each with `verified`, SSO fields and the `dnsRecord` to publish (`TXT` at the domain with value `gradebook-verification=<token>`). |
| POST | `/api/schools/email-domains` | Add a domain (`AddEmailDomainDto`). The input is normalized (scheme, `@`, path and trailing dot stripped). Public mail providers (gmail.com, outlook.com and others) are refused; a domain another school has verified, or one already on the list, is a `409`. `autoJoin` defaults to true for `student` domains and false otherwise; `staffRole` defaults to `teacher`. |
| PATCH | `/api/schools/email-domains/:id` | Change audience, auto-join, staff role and SSO settings (`UpdateEmailDomainDto`). See validation rules below. |
| DELETE | `/api/schools/email-domains/:id` | Remove a domain (`204`). Stops new joins; nobody already in the school is removed. |
| POST | `/api/schools/email-domains/:id/verify` | Look up the domain's TXT records and mark it verified if the token is present (`400` with a "can take up to an hour" message otherwise; `409` if another school verified it first). Throttled: 20 per 15 minutes on the `claim-code` throttler. |

Organisation admins manage any school's domains with the same bodies and rules through `/api/organisation/schools/:id/email-domains[/:domainId[/verify]]` and list every school's at `GET /api/organisation/sign-in/domains` (both in `src/organisation/sign-in.controller.ts`).

Signed-in user side, `EmailDomainJoinController`, `AuthGuard` only. The address used is the session's email, never a request body.

| Method | Path | What it does |
|--------|------|--------------|
| GET | `/api/auth/email-domain/match` | `{ match: DomainMatch \| null }` - the school the caller's address would put them in. Only for users with no school who have completed their profile, and only a verified domain for their account type (a `student` account matches `student` or `any` domains; staff match `staff` or `any`) at an active school. |
| POST | `/api/auth/email-domain/join` | Join the matched school. Students, and staff on auto-join domains, are seated (`{ status: 'joined' }`); staff on approval domains get a join request (`{ status: 'requested' }`; an existing pending request counts as success). `404` with no match, `409` if already in a school. Throttled: 10 per 15 minutes. |

Update validation (`PATCH`):

- `ssoProvider` must be a provider available to the domain's own school right now (`SsoRegistry.resolve(id, schoolId)`: the school's own app - Google, Microsoft or its custom OpenID Connect provider `oidc` once it has a client, secret and issuer - else the install-wide env app, or SAML), or `null` (which also turns off `ssoRequired`). Another school's app never counts. `ssoRequirement()` resolves the same way (its label is the school's own, e.g. custom OpenID Connect's button name), so a required provider the school has since switched off lets email codes work again.
- `azureTenantId` must be a GUID (stored lower-case).
- `samlEntryPoint` must be an `https://` URL; `samlCertificate` must be a valid X.509 certificate (PEM or bare base64, stored as PEM via `normalizeCertificate`).
- Choosing or editing a `saml` connection requires entry point, issuer and certificate together.
- `ssoRequired: true` requires a verified domain, a chosen provider, a tenant id for `azure`, and a complete connection for `saml`, so a domain cannot be locked out by requiring SSO that cannot work.
- An empty patch is `400 Nothing to update`.

### Services / exports

`EmailDomainModule` exports `EmailDomainService`:

- Admin: `list`, `add`, `update`, `remove`, `verify` (the caller's active school), and the same with an explicit school for the organisation console: `listForSchool(schoolId)`, `addToSchool(schoolId, actor, input)`, `updateInSchool(schoolId, id, patch, actor)`, `removeFromSchool(schoolId, id, actor)`, `verifyInSchool(schoolId, id, actor)` (`actor` = `SsoActor` `{ id, via: 'school_admin' | 'organisation_admin' }`, recorded in the audit log; the active-school forms pass `school_admin`); `listAll()` (every school's, with `schoolId` and `schoolName`). The explicit forms do not check the school exists - the caller does (`OrganisationService.requireSchool`). A domain of another school is a 404 either way.
- Joining: `matchFor(userId, email)`, `join(userId, email)`, `tryAutoJoin(userId, email)` (never throws; returns `null` on no match or failure). Seating runs the SQL function `public.join_school_by_email_domain(user, school, audience, role)` and then clears the `profile:<user>`, `student-context:<user>`, `students:<school>` and permission cache keys.
- Sign-in: `verifiedDomainFor(email)`, `verifiedDomainById(id)` (both return a `VerifiedDomain` with SSO settings), and `ssoRequirement(email)` - the `{ providerId, label }` an address must use, or `null` when SSO is not required, the provider is not available to the domain's school, or the adapter says the domain's setup is incomplete (so email codes keep working).

Types: `DomainAudience` (`student`, `staff`, `any`), `AccountAudience`, `DomainStaffRole` (`teacher`, `member`), `VerifiedDomain`, `DomainMatch`, `DomainJoinResult`.

### Other

`email-domain.util.ts` (pure functions): `normalizeDomain`, `isFreeMailDomain` (a fixed list of public providers; DNS verification remains the real gate), `domainOfEmail`, `txtHasToken` (TXT records may arrive split into chunks), and `VERIFICATION_PREFIX = 'gradebook-verification='`.

## Used by

- `src/auth/auth.module.ts`, `src/sso/sso.module.ts` and `src/organisation/organisation.module.ts` import `EmailDomainModule`; `src/organisation/sign-in.controller.ts` calls the explicit-school methods and `listAll`.
- `src/auth/auth.controller.ts` calls `tryAutoJoin` after onboarding when the user did not pick a school.
- `src/auth/auth.service.ts` calls `ssoRequirement` to refuse email codes for SSO-required domains.
- `src/sso/sso.service.ts` calls `verifiedDomainFor` / `verifiedDomainById` to find a domain's SSO configuration and `tryAutoJoin` after an SSO sign-in.
- Web admin: `frontend/app/dashboard/email-domains/page.tsx` and its `_components/` (`EmailDomainsManager`, `DomainFormDialog`, `VerifyPanel`, `SsoPanel`, all taking an `apiBase`; the organisation console's school page `frontend/app/organisation/schools/[schoolId]/page.tsx` reuses `EmailDomainsManager` with `/organisation/schools/<id>`); types in `frontend/lib/email-domains.ts`; linked from `frontend/components/layout/app-sidebar.tsx`.
- Web join: `frontend/app/schools/page.tsx` (`/auth/email-domain/match`, `/auth/email-domain/join`).
- Mobile join: `mobile/app/(auth)/schools.tsx`.
- `backend/scripts/smoke.ts` lists the domains as an admin.

## Depends on

- `PrismaService` and `CacheService` (both global).
- `SsoRegistry` (`src/sso/sso.registry.ts`) and `normalizeCertificate` from `src/sso/adapters/saml.adapter.ts`.
- `SsoAuditService` and `SsoAlertService` (global `SsoCoreModule`) - the audit log and change alerts.
- `RequireStepUp` from `src/auth/step-up.guard.ts`.
- `permCacheKey` from `src/permission/permission.effective.ts`.
- `AuthGuard`, `AdminGuard` from `src/auth/`; `@nestjs/throttler` (`claim-code` throttler configured in `src/app.module.ts`).
- `userSchoolId`, `isoDate`, `isUniqueViolation`, `raisedMessage` from `src/common/`.
- Node's `dns.promises.resolveTxt` for verification.

## Data

`prisma/schema/school.prisma` (Postgres schema `public`):

- `public.school_email_domain` - read/write.
- `public.sso_audit_log` - one row per change, in the change's transaction (`prisma/schema/sso.prisma`).
- `public.school_join_request` - created for staff approval domains.
- `public.user_profile`, `public.school` - read.
- Seating is done inside the SQL function `public.join_school_by_email_domain` (defined in `prisma/migrations/0_baseline/migration.sql`).

## Configuration

| Variable | Default | Effect |
|----------|---------|--------|
| `ALLOW_UNVERIFIED_EMAIL_DOMAINS` | `false` | `true` skips the DNS TXT check so a local stack can verify made-up domains like `demo.test`. Ignored when `NODE_ENV=production`. |

## Files

| File | Purpose |
|------|---------|
| `email-domain.module.ts` | Module; both controllers, exports `EmailDomainService`. |
| `email-domain.controller.ts` | `EmailDomainController` (`/schools/email-domains`) and `EmailDomainJoinController` (`/auth/email-domain`). |
| `email-domain.service.ts` | Domain management, DNS verification, joining, SSO lookups. |
| `email-domain.util.ts` | Domain normalization, free-mail list, TXT token matching. |
| `dto/email-domain.dto.ts` | `AddEmailDomainDto`, `UpdateEmailDomainDto`. See [dto/README.md](dto/README.md). |
| `email-domain.service.test.ts` | Service tests with mocked Prisma, cache, DNS and SSO registry. Audit entries and alerts for these writes are tested in `src/sso/sso-audit.test.ts`; step-up placement in `src/auth/step-up.test.ts`. |
| `email-domain.util.test.ts` | Tests for the pure helpers. |

## Tests

```bash
cd backend && bun test src/email-domain
```

Covered: refusing public providers and junk, conflicts with another school's verified domain or a duplicate, admins without a school, list shape, default auto-join per audience; verification with and without the TXT record, races, another school's domain, the dev bypass being ignored in production; matching by account type and verified status, shared domains, users already in a school or not onboarded; joining through the SQL function with cache clearing, already-in-a-school conflicts and staff join requests; SAML settings (complete connection, base64 certificate stored as PEM, https and X.509 checks, refusing to break a live connection, prerequisites for requiring SSO); and the util functions; the explicit-school forms (scoped to the given school, creator recorded, another school's domain a 404) and `listAll`.

## See also

- [SSO](../../../docs/content/sso.md)
- [School backend doc](../../../docs/content/backend/school.md)
- [Environment variables](../../../docs/content/environment-variables.md)
