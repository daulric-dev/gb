# Single sign-on (`src/sso`)

Sign-in through a school's identity provider. The API speaks the protocols itself - OpenID Connect (via `openid-client`) for Google and Microsoft, and SAML 2.0 (via `@node-saml/node-saml`) for any IdP a school connects - so no third-party auth service is involved.

A sign-in is a series of browser redirects: `GET /api/auth/sso/:provider/start` -> the provider -> `GET /api/auth/sso/callback` (OIDC) or `POST /api/auth/sso/saml/acs` then the callback (SAML) -> back to the web app (or to the mobile app with a one-time code). Along the way this module keeps the pending state in the cache, ties the sign-in to the starting browser with an HttpOnly `gb_sso_flow` cookie (login-CSRF protection), finds or creates the user, starts a normal `gb_session` session, creates a profile and - when the provider vouches for a verified school email domain - seats the user in that school.

Each provider is an **adapter** behind the `SsoAdapter` interface in `sso.types.ts`. Nothing outside `sso.registry.ts` knows which providers exist.

Single sign-on is set up **per school**. Each school may register its own Google and Microsoft apps (`public.school_sso_provider`, one row per school and provider), edited by the school's admin (`/api/schools/current/sso/providers`, `school:update`) or an organisation admin (`/api/organisation/schools/:id/sso/providers`). SAML needs no app: each email domain holds its identity provider. The env vars (`SSO_PROVIDERS`, `GOOGLE_*`, `MICROSOFT_*`) are an optional **install-wide fallback**, used only for a school that has no row for that provider (and for the login buttons shown before anyone types an email), so env-only installs keep working.

Resolution for (school, provider), in `SsoSettingsService.resolve` / `SsoRegistry.resolve`:

1. The school has a row: that row alone. Switched off, or missing its client ID or secret, the provider is unavailable for the school - the env never fills a gap or overrides "off".
2. No row, or no school known yet (no email typed): the env config.
3. SAML (`needsClient: false`): always available; a domain is ready once its IdP details are complete.

Whoever edits a school's SSO settings can point a domain at an identity provider they control and sign in as anyone on it, so changes are guarded three ways (see [docs/content/sso.md](../../../docs/content/sso.md#protecting-sso-settings)):

1. **Audit log** - `SsoAuditService` writes one `public.sso_audit_log` row per change (domain add / remove / verify / update, sign-in app save) in the **same transaction** as the change, from both consoles. `changes` is `{ field: { before, after } }` and never holds a secret: certificates are SHA-256 fingerprints (`certificateFingerprint`), client secrets only `"set"` / `"cleared"`.
2. **Alert email** - after the commit, `SsoAlertService.notify` mails the school's admin and every organisation admin (stored, plus verified `ORG_ADMIN_EMAILS` accounts; the actor too) one "Single sign-on settings changed for <School>" email per request when a change moved where people sign in: SAML entry point / issuer / certificate, a domain's provider or Microsoft tenant, Require SSO turned off, or a sign-in app's client ID / secret / on-off. Skipped (logged) without SMTP; a failure is logged and never fails the request.
3. **Step-up** - every SSO write route carries `@RequireStepUp()` (`src/auth/step-up.guard.ts`): 403 `STEP_UP_REQUIRED` until the session confirmed an emailed code in the last ten minutes.

A school is found from the address: verified domain -> `school_id`. `start` stores `schoolId` and `configSource` (`school` or `env`) in the pending state and hands the adapter that school's config; the callback (and the SAML ACS) resolves the provider for the **same** school again and refuses (`error=provider`) if it is no longer available or its source changed, so the code is always exchanged with the client that asked for it - never another school's. Rows are cached per school for 30 s (a save drops this instance's copy at once).

## What it provides

### HTTP routes

All under `@Controller('auth/sso')`. Only `suggested-profile` needs a session; the rest are public, several with tighter `auth-ip` throttles.

| Method | Path | Guard / who may call | What it does |
| --- | --- | --- | --- |
| GET | `/api/auth/sso/providers` | Public | Login buttons usable without knowing the school (`id`, `label`, `kind`): the OAuth providers the env sets up install-wide. School-specific providers (a school's own app, SAML) are offered by `discover` once the email is known. |
| GET | `/api/auth/sso/discover?email=` | Public, throttled (300/h per IP) | Whether the address's verified school domain has a provider available to its school (`provider`) and requires it (`required`). |
| GET | `/api/auth/sso/saml/metadata` | Public | Our SAML service-provider metadata XML (one SP for the install; see below). |
| POST | `/api/auth/sso/saml/acs` | Public, throttled (120/h) | The IdP's form POST (`SAMLResponse`, `RelayState`). Checks the assertion, parks the identity under the state and 303-redirects to the callback. |
| GET | `/api/auth/sso/:provider/start` | Public, throttled (120/h) | Query `next`, `platform` (`web`/`mobile`), `email`, `code_challenge` (required for `mobile`: base64url SHA-256 of an app-held verifier, 43 chars; a malformed one is a 400, a missing one - an app build from before PKCE - redirects to `gradebook://sso?error=` with `OUTDATED_APP_MESSAGE`, "This version of GradeBook is out of date...", which old builds show as is). Stores the pending sign-in, sets `gb_sso_flow`, 302-redirects to the provider. |
| GET | `/api/auth/sso/callback` | Public | Finishes the sign-in and redirects: web gets a session cookie and goes to `next` (or `/`, or `/onboard`); mobile goes to `MOBILE_SSO_RETURN_URL?code=...`. Failures redirect to `/login?error=<reason>` (or the mobile URL with `error`); this route never returns an error page. |
| POST | `/api/auth/sso/handoff` | Public, throttled (60/h) | Body `{ code, code_verifier }`. The mobile app trades its one-time code (valid 120 s) plus the verifier for its `/start` challenge for a session; a missing or wrong verifier is refused and still burns the code (stops other apps catching `gradebook://` and planted-link login CSRF); 204. |
| GET | `/api/auth/sso/suggested-profile` | `AuthGuard` | Names (and picture) from the provider the user last signed in with, to prefill onboarding; `{ profile: null }` for email-code accounts. |

Audit log reads (newest first, `limit` default 50 / max 200, `before` = the id of the last entry shown) -> `[{ id, createdAt, action, domain, actor: { id, name, email } | null, actorVia, changes }]`:

| Method | Path | Guard / who may call |
| --- | --- | --- |
| QUERY | `/api/schools/current/sso/audit` (body `{ limit?, before? }`, `ListSsoAuditQueryDto` in `sso-audit.dto.ts`) | `AuthGuard`, `PermissionGuard` `school:update`, `AdminGuard`; the active school only (`src/school/school.controller.ts`) |
| QUERY | `/api/organisation/schools/:id/sso/audit` (same body) | `AuthGuard`, `OrganisationAdminGuard`; any school, 404 for an unknown one (`src/organisation/sign-in.controller.ts`) |

`PUT .../sso/providers/:key` (both consoles) needs a step-up confirmation (`@RequireStepUp()`).

### Services / exports

- `SsoCoreModule` is `@Global()` and exports **`SsoRegistry`** - `adapter(id)` / `all()` / `known(id)`, `resolve(id, schoolId)` (an *available* provider for that school with its `config`, `source` and `clientKey`, or undefined), `availableFor(schoolId)`, `unscoped()` (env-available OAuth providers, for the login buttons), `configFor(adapter, schoolId)`; **`SsoSettingsService`** - `forSchool(schoolId)` (rows, secrets decrypted, 30 s cache), `resolve(adapter, schoolId)`, `save(schoolId, provider, write, actorId, inTransaction?)` (encrypts; one transaction - find, update or `createMany` with `skipDuplicates`, no `upsert` - with the hook getting the row as it was, for the audit log), `invalidate(schoolId)`; **`SchoolSsoService`** - `list(schoolId)` / `update(schoolId, key, dto, actor)` behind both admin routes (items never carry a secret; `actor` is `{ id, via: 'school_admin' | 'organisation_admin' }`; logs `app_enabled` / `app_disabled` / `app_changed` / `app_secret_changed` via `appSaveEntries`); **`SsoAuditService`** - `record(tx, schoolId, actor, entries)` / `list(schoolId, { limit, before })`; and **`SsoAlertService`** - `notify(schoolId, actor, entries)` (never throws), `recipients(schoolId)`. Without the settings service (tests, scripts) the registry gives every school the env. It is separate from `SsoModule` so `src/email-domain`, `src/school` and `src/organisation` can use it without importing the sign-in module.
- `school-sso.dto.ts` - `UpdateSchoolSsoProviderDto` (`enabled?`, `clientId?`, `clientSecret?` write-only, `settings?`).
- `sso-audit.dto.ts` - `ListSsoAuditQueryDto`, the QUERY body of both audit routes: `limit?` integer 1-200 (default 50), `before?` UUID. An empty body is the first page.
- `sso-secret.ts` - `encryptSsoSecret({ schoolId, provider }, plaintext)` / `decryptSsoSecret(owner, stored)`: AES-256-GCM through `src/account/secret-box.ts`: key = HKDF-SHA256 with info `gradebook:school-sso-secret:v1` of `DATA_ENCRYPTION_KEY` when set (`v2:<kid>:<iv>:<tag>:<ct>`), else of `AUTH_SECRET` (`v1:<iv>:<tag>:<ct>`, also every older value); the school id and provider are additional data - a ciphertext copied to another school's or provider's row does not decrypt. Decryption returns null on any failure - typically after the key it was saved under changed, which means the secret must be entered again. `bun run secrets:reencrypt` moves `v1` values onto `DATA_ENCRYPTION_KEY` before an `AUTH_SECRET` rotation.
- `SsoModule` (not exported) provides `SsoService`: `providers`, `discover`, `samlMetadata`, `start`, `samlAcs`, `callback`, `handoff`, `signIn`, `provision`, `suggestedProfile`, `takeState`.
- Helpers other code imports:
  - `sso.config.ts` - `enabledProviders()`, `apiBase()`, `oidcRedirectUri()`, `samlAcsUrl()`, `samlEntityId()`, `emailDomainOf()`.
  - `sso.service.ts` - `safeNext()` (open-redirect-safe relative path), `FLOW_COOKIE`, `PendingSignIn`.
  - `adapters/saml.adapter.ts` - `normalizeCertificate()`.

### How a sign-in decides what the user gets

`SsoService.signIn()`:

1. Looks up the verified school domain for the identity's email. If that domain requires a different provider, the sign-in is refused (redirect with the reason).
2. Asks the adapter `vouchesForDomain(identity, domain)` - the security boundary - and `verifiesEmail?(identity)`.
3. `AccountService.userForIdentity()` finds the user by linked identity, or links/creates by email only when the email is trusted. An untrusted email with no linked identity is refused (403), whether or not an account has that address.
4. `provision()` creates a `user_profile` if missing (with names and account type only when a vouched domain says `student` or `staff`), and calls `EmailDomainService.tryAutoJoin()` when the domain is vouched for, the address is the account's own, and the user has no school yet. Users without a name go to `/onboard`.

## Used by

- `src/app.module.ts` imports `SsoCoreModule` and `SsoModule`.
- `src/organisation/sign-in.controller.ts` and `src/school/school.controller.ts` inject `SchoolSsoService` for the per-school provider routes.
- `src/email-domain/email-domain.service.ts` injects `SsoRegistry` (validates a domain's `sso_provider` against its own school, decides whether SSO is required) and imports `normalizeCertificate` for SAML certificates entered by admins.
- Web: the per-school single sign-on section `frontend/app/dashboard/email-domains/_components/SchoolSingleSignOn.tsx` (sign-in apps + domains; on `/dashboard/settings`, `/dashboard/email-domains` and `frontend/app/organisation/schools/[schoolId]/page.tsx`) calls the provider routes and builds test sign-in links with `ssoStartUrl`; `frontend/lib/sso.ts` builds start, metadata and ACS URLs; `frontend/app/login/page.tsx` calls `providers` and `discover`; `frontend/app/onboard/page.tsx` calls `suggested-profile`; the organisation overview names providers with `providers`.
- Mobile: `mobile/src/lib/sso.ts` calls `providers`, `discover`, `suggested-profile`, `start` (with `platform=mobile`) and `handoff`.
- Scripts: `scripts/smoke.ts` checks `discover` for the demo domain.

## Depends on

- `CacheService` (global) - pending state `sso-state:<state>` (10 min) and mobile handoff `sso-handoff:<code>` (120 s).
- `AccountService`, `SessionService` (global `AccountModule`) - users, linked identities, sessions.
- `EmailDomainService` (`EmailDomainModule`, imported) - verified domains, auto-join.
- `PrismaService` (global).
- `primaryOrigin()` from `src/config/origins.ts` - where web sign-ins return, and the alert email's link (`/dashboard/settings#single-sign-on` for the school's admin, `/organisation/schools/<id>#single-sign-on` for organisation admins).
- `MailService` (global) - SSO change alerts.

## Data

- `public.user_profile` - read and created by `provision()` ([`school.prisma`](../../prisma/schema/school.prisma)).
- `public.school_sso_provider` - read by `SsoSettingsService` per school (every 30 s at most), written by `save()` ([`sso.prisma`](../../prisma/schema/sso.prisma), migration `20261103120000_school_sso`, which dropped the earlier server-wide `sso_provider_setting`).
- `account.identity` - read by `suggestedProfile()`; written by `AccountService` ([`account.prisma`](../../prisma/schema/account.prisma)).
- `public.school_email_domain` - read through `EmailDomainService` (`sso_provider`, `sso_required`, tenant and SAML settings).
- `public.sso_audit_log` - written by `SsoAuditService.record` inside each change's transaction, read by `list` ([`sso.prisma`](../../prisma/schema/sso.prisma), migration `20261103130000_sso_audit`). `domain_id` and `actor_id` have no foreign key, so entries outlive the domain and the account; cascades with the school.

## Configuration

Each school's own sign-in apps are the primary place for credentials; these are the optional install-wide fallback for schools without their own (and the only thing the login page's buttons use before an email is typed).

| Variable | Default | Effect |
| --- | --- | --- |
| `AUTH_SECRET` | dev fallback | Derives the key that encrypts schools' client secrets. Rotating it makes them unreadable: re-enter them on each school's Sign-in apps. |
| `SSO_PROVIDERS` | empty (all off) | Comma list of OAuth adapter ids the env app is on for: `google`, `azure`. Applies only to schools with no row for that provider. `saml` is ignored (SAML is always available per domain). |
| `API_URL` | dev: request host, else `http://localhost:3001`; production: required at boot | Public API origin (the `Host` header is never used in production); redirect URI is `${API_URL}/api/auth/sso/callback`, ACS is `${API_URL}/api/auth/sso/saml/acs`. Set it wherever SSO is on. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | The install-wide Google app, for schools without their own. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | unset | The same for Microsoft (`azure`): a multitenant Entra app. |
| `SAML_SP_ENTITY_ID` | `${API_URL}/api/auth/sso/saml/metadata` | Our SAML entity ID and audience. One for the install: per-school entity IDs would break identity providers already configured with this one, so every school's IdP is given the same SP metadata. |
| `MOBILE_SSO_RETURN_URL` | `gradebook://sso` | Where mobile sign-ins return. |
| `NODE_ENV` | - | `production` marks the `gb_sso_flow` cookie `Secure`. |

## Files

| File | Purpose |
| --- | --- |
| `sso.types.ts` | `SsoAdapter` interface and the context / identity / profile types. |
| `sso.registry.ts` | The list of adapters (`createAdapters()`) and `SsoRegistry`. Register new adapters here. |
| `sso-settings.service.ts` | `SsoSettingsService`: each school's rows (30 s cache per school), resolution over the env fallback, save. |
| `school-sso.service.ts` | `SchoolSsoService`: list and save a school's sign-in apps for the admin routes. |
| `school-sso.dto.ts` | `UpdateSchoolSsoProviderDto`. |
| `sso-audit.dto.ts` | `ListSsoAuditQueryDto` (QUERY body of the audit routes). |
| `sso-audit.service.ts` | `SsoAuditService`, `SsoActor`, the action list, `certificateFingerprint`, `secretState`, `diff`. |
| `sso-alert.service.ts` | `SsoAlertService` and `isAlerting` (which entries mail the admins). |
| `sso-alert.email.ts` | The "Single sign-on settings changed" email (shared account layout, escaped). |
| `sso-audit.test.ts` | Audit entries per change with before/after and no secrets (fingerprints only), written through the transaction client and failing the change with it; app secret set/cleared; reading (order, pagination, limits, cursor of another school refused, actor); route authz; alert rules, recipients, one email per recipient per request, escaping, skipped without SMTP, failures swallowed. |
| `sso-secret.ts` | Client secret encryption (AES-256-GCM, HKDF from `AUTH_SECRET`, bound to school + provider). |
| `sso-settings.test.ts` | Encryption bound to school and provider, rotation; per-school resolution (row alone, env only without a row, off beats env), cache and invalidation, DB failure; start/callback use the address's school's own client and never another school's, the pending state carries the school id, mid-flight changes refused, discovery per school. |
| `sso-core.module.ts` | Global module exporting `SsoRegistry`, `SsoSettingsService`, `SchoolSsoService`, `SsoAuditService` and `SsoAlertService`. |
| `sso.module.ts` | Controller and `SsoService`; imports `EmailDomainModule`. |
| `sso.controller.ts` | The routes above and their query/body DTOs (defined inline). |
| `sso.service.ts` | The sign-in flow, account linking and provisioning. |
| `sso.config.ts` | Env-derived URLs and helpers. |
| `adapters/` | One adapter per provider - see [adapters/README.md](./adapters/README.md). |
| `sso.test.ts` | Tests for the registry, every adapter, `standardProfile`, `safeNext`, `signIn` and the full start/callback/ACS/handoff flow. |

## Tests

```bash
cd backend && bun test src/sso
```

`sso.test.ts` sets the SSO env vars itself and uses the fake SAML IdP in [`src/test/saml-idp.ts`](../test/saml-idp.ts) to sign real assertions.

## See also

- [docs/content/sso.md](../../../docs/content/sso.md) - how sign-in works, turning providers on, school settings, adding a provider, testing locally.
- [docs/content/backend/auth.md](../../../docs/content/backend/auth.md)
- [src/account/README.md](../account/README.md), [src/email-domain/README.md](../email-domain/README.md), [src/auth/README.md](../auth/README.md)
