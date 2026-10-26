# Single sign-on (`src/sso`)

Sign-in through a school's identity provider. The API speaks the protocols itself - OpenID Connect (via `openid-client`) for Google and Microsoft, and SAML 2.0 (via `@node-saml/node-saml`) for any IdP a school connects - so no third-party auth service is involved.

A sign-in is a series of browser redirects: `GET /api/auth/sso/:provider/start` -> the provider -> `GET /api/auth/sso/callback` (OIDC) or `POST /api/auth/sso/saml/acs` then the callback (SAML) -> back to the web app (or to the mobile app with a one-time code). Along the way this module keeps the pending state in the cache, ties the sign-in to the starting browser with an HttpOnly `gb_sso_flow` cookie (login-CSRF protection), finds or creates the user, starts a normal `gb_session` session, creates a profile and - when the provider vouches for a verified school email domain - seats the user in that school.

Each provider is an **adapter** behind the `SsoAdapter` interface in `sso.types.ts`. Nothing outside `sso.registry.ts` knows which providers exist.

## What it provides

### HTTP routes

All under `@Controller('auth/sso')`. Only `suggested-profile` needs a session; the rest are public, several with tighter `auth-ip` throttles.

| Method | Path | Guard / who may call | What it does |
| --- | --- | --- | --- |
| GET | `/api/auth/sso/providers` | Public | The enabled providers (`id`, `label`, `kind`) for the login buttons and the admin picker. |
| GET | `/api/auth/sso/discover?email=` | Public, throttled (300/h per IP) | Whether the address's verified school domain has its own provider (`provider`) and requires it (`required`). |
| GET | `/api/auth/sso/saml/metadata` | Public | Our SAML service-provider metadata XML; 404 when SAML is off. |
| POST | `/api/auth/sso/saml/acs` | Public, throttled (120/h) | The IdP's form POST (`SAMLResponse`, `RelayState`). Checks the assertion, parks the identity under the state and 303-redirects to the callback. |
| GET | `/api/auth/sso/:provider/start` | Public, throttled (120/h) | Query `next`, `platform` (`web`/`mobile`), `email`, `code_challenge` (required for `mobile`: base64url SHA-256 of an app-held verifier, 43 chars; a malformed one is a 400, a missing one - an app build from before PKCE - redirects to `gradebook://sso?error=` with `OUTDATED_APP_MESSAGE`, "This version of GradeBook is out of date...", which old builds show as is). Stores the pending sign-in, sets `gb_sso_flow`, 302-redirects to the provider. |
| GET | `/api/auth/sso/callback` | Public | Finishes the sign-in and redirects: web gets a session cookie and goes to `next` (or `/`, or `/onboard`); mobile goes to `MOBILE_SSO_RETURN_URL?code=...`. Failures redirect to `/login?error=<reason>` (or the mobile URL with `error`); this route never returns an error page. |
| POST | `/api/auth/sso/handoff` | Public, throttled (60/h) | Body `{ code, code_verifier }`. The mobile app trades its one-time code (valid 120 s) plus the verifier for its `/start` challenge for a session; a missing or wrong verifier is refused and still burns the code (stops other apps catching `gradebook://` and planted-link login CSRF); 204. |
| GET | `/api/auth/sso/suggested-profile` | `AuthGuard` | Names (and picture) from the provider the user last signed in with, to prefill onboarding; `{ profile: null }` for email-code accounts. |

### Services / exports

- `SsoCoreModule` is `@Global()` and exports **`SsoRegistry`** - `get(id)` (an *enabled* adapter or undefined), `known(id)` (any registered adapter), `enabled()` (public info for enabled adapters). It is separate from `SsoModule` so `src/email-domain` can use it without importing the sign-in module.
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
- `src/email-domain/email-domain.service.ts` injects `SsoRegistry` (validates a domain's `sso_provider`, decides what discovery offers) and imports `normalizeCertificate` for SAML certificates entered by admins.
- `src/billing/school/billing.service.ts` imports `apiBase()` to build webhook callback URLs.
- Web: `frontend/lib/sso.ts` builds start, metadata and ACS URLs; `frontend/app/login/page.tsx` calls `providers` and `discover`; `frontend/app/onboard/page.tsx` calls `suggested-profile`; `frontend/app/dashboard/email-domains/page.tsx` lists `providers` for the admin picker.
- Mobile: `mobile/src/lib/sso.ts` calls `providers`, `discover`, `suggested-profile`, `start` (with `platform=mobile`) and `handoff`.
- Scripts: `scripts/smoke.ts` checks `discover` for the demo domain.

## Depends on

- `CacheService` (global) - pending state `sso-state:<state>` (10 min) and mobile handoff `sso-handoff:<code>` (120 s).
- `AccountService`, `SessionService` (global `AccountModule`) - users, linked identities, sessions.
- `EmailDomainService` (`EmailDomainModule`, imported) - verified domains, auto-join.
- `PrismaService` (global).
- `primaryOrigin()` from `src/config/origins.ts` - where web sign-ins return.

## Data

- `public.user_profile` - read and created by `provision()` ([`school.prisma`](../../prisma/schema/school.prisma)).
- `account.identity` - read by `suggestedProfile()`; written by `AccountService` ([`account.prisma`](../../prisma/schema/account.prisma)).
- `public.school_email_domain` - read through `EmailDomainService` (`sso_provider`, `sso_required`, tenant and SAML settings).

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `SSO_PROVIDERS` | empty (all off) | Comma list of adapter ids to offer: `google`, `azure`, `saml`. |
| `API_URL` | request host, else `http://localhost:3001` | Public API origin; redirect URI is `${API_URL}/api/auth/sso/callback`, ACS is `${API_URL}/api/auth/sso/saml/acs`. Set it wherever SSO is on. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | Google is enabled only when both are set and `google` is listed. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | unset | Same for Microsoft (`azure`), a multitenant Entra app. |
| `SAML_SP_ENTITY_ID` | `${API_URL}/api/auth/sso/saml/metadata` | Our SAML entity ID and audience. |
| `MOBILE_SSO_RETURN_URL` | `gradebook://sso` | Where mobile sign-ins return. |
| `NODE_ENV` | - | `production` marks the `gb_sso_flow` cookie `Secure`. |

## Files

| File | Purpose |
| --- | --- |
| `sso.types.ts` | `SsoAdapter` interface and the context / identity / profile types. |
| `sso.registry.ts` | The list of adapters and `SsoRegistry`. Register new adapters here. |
| `sso-core.module.ts` | Global module exporting `SsoRegistry`. |
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
