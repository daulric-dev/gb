---
label: Single Sign-On
---

# Single sign-on

Students and staff can sign in with their school's Google Workspace,
Microsoft 365 or SAML identity provider instead of an emailed code. When the
provider vouches for a school's verified email domain, the first sign-in
creates the account and puts the user in the school - nobody fills in a form.

The API speaks the protocols itself: OpenID Connect through
[`openid-client`](https://github.com/panva/openid-client) and SAML 2.0
through [`@node-saml/node-saml`](https://github.com/node-saml/node-saml). No
hosted auth service sits in between, and a finished sign-in is an ordinary
`gb_session` cookie, the same as an email-code sign-in.

## How sign-in works

1. The user types their email on the login page.
2. The app calls `GET /api/auth/sso/discover?email=`. If the address's school
   has a provider set up, the app offers it; if the school **requires** it,
   the app sends the browser straight to the provider and no email code is
   sent.
3. `GET /api/auth/sso/<provider>/start` creates a random `state`, keeps the
   pending sign-in (provider, PKCE verifier, nonce or SAML request id, `next`,
   platform, school domain) in the cache for 10 minutes, sets a short-lived
   `gb_sso_flow` cookie that ties the sign-in to this browser, and redirects
   to the provider:
   - **OpenID Connect** (Google, Microsoft): authorization code flow with
     PKCE (S256), `state` and `nonce`.
   - **SAML**: an AuthnRequest by HTTP-Redirect with `RelayState = state`.
4. The provider sends the browser back:
   - OpenID Connect: `GET /api/auth/sso/callback?code&state`. The code is
     exchanged and the ID token's signature, issuer, audience, expiry and
     nonce are checked.
   - SAML: the IdP form-posts to `POST /api/auth/sso/saml/acs`. The assertion
     must be signed by the school's certificate, come from its entity ID, be
     addressed to our entity ID, answer the request this sign-in sent
     (`InResponseTo`), and be within its validity window (60 s clock skew).
     The ACS then redirects (303) to the callback, so the rest runs as a
     normal top-level GET with the flow cookie.
5. The callback uses the state once (a replay finds nothing), checks the flow
   cookie, finds or creates the user (`account.app_user`, linked through
   `account.identity`), creates or completes the profile, joins the school
   when the domain is vouched for, sets `gb_session` and redirects to the web
   app (`next`, `/` or `/onboard`).
6. The mobile app instead receives `gradebook://sso?code=<one-time code>`
   (valid 2 minutes, single use) and redeems it with
   `POST /api/auth/sso/handoff {code}`, which sets `gb_session` in the app's
   own cookie jar - the system browser's cookies never reach the app.

Failures redirect to `/login?error=<reason>` (web) or
`gradebook://sso?error=<reason>` (mobile).

### Linking to existing accounts

An identity is matched by (provider, subject) first. The first time, it links
to the account with the same address only when the provider vouches for that
address (or, for Google, when Google verified it - Gmail or a Workspace's own
domain). Otherwise a sign-in whose address already belongs to someone is
refused with "Sign in with an email code to link it", so an unverified
address can never take over an account. An unverified address that belongs
to no one does not create an account either: the sign-in is refused with
"Sign in with an email code instead", and the email code creates it.

## Setting up a school's single sign-on

Single sign-on is set up **per school**: each school has its own SSO
configuration, if it has one. The section is the same everywhere it appears:

- the school admin's **Settings > Single sign-on** (`/dashboard/settings`)
  and **Email Domains** (`/dashboard/email-domains`) pages, for the active
  school (needs `school:update`);
- **Organisation console > Schools > <school>** for organisation admins, for
  any school.

A school with nothing set up shows "This school signs in with email codes.
Set up SSO if it has Google Workspace, Microsoft or a SAML provider." The
section has two parts.

**Sign-in apps** - the school's own Google and Microsoft apps. Each row has
an on/off switch, the client ID, a write-only client secret, the redirect URI
to copy into the provider, and a status: *Not set up* by default, *On*,
*On - server's app* (the install-wide fallback below), *Setup incomplete* or
*Off*. Turning one on without a client ID and secret is refused. Saves take
effect without a restart (this instance at once, others within ~30 s).

**Email domains** - add, verify with the DNS TXT record shown, remove, and
for each domain: who it is for (audience, auto-join, staff role), its sign-in
provider - only providers available to *this* school (its own apps, the
server's fallback app, or SAML with the school's IdP sign-on URL, entity ID
and certificate plus our metadata URL, ACS URL and entity ID to copy) -
Microsoft tenant ID, **Require single sign-on**, and a **Test sign-in** link
(open it in a private window, since finishing it signs that browser in). The
organisation **Overview** lists every school's domains.

**Secrets.** The client secret is write-only: the API never returns it, only
`hasSecret` and `secretSource` (`school`, `env` or none). It is stored in
`public.school_sso_provider.client_secret_enc`, encrypted with AES-256-GCM
under a key derived from `AUTH_SECRET` (HKDF-SHA256) with the school id and
provider as additional data, so a ciphertext copied to another school's or
provider's row does not decrypt. **Rotating `AUTH_SECRET` makes saved secrets
unreadable**: the page says so and the provider is unavailable for that
school until the secret is entered again.

**How a sign-in picks the app.** The address's verified domain gives the
school; the school's own row for the provider decides. `/start` keeps the
school id in the pending sign-in, and the callback exchanges the code with
the same school's client - never another school's. Google's `hd` check and
Microsoft's per-domain tenant check are unchanged.

**Install-wide fallback (optional).** The env vars below are used only for a
school that has **no row** for that provider - so an env-only install keeps
working without any school saving anything. Once a school saves its own
Google (or Microsoft) settings, even switched off, its row alone applies for
that provider; the env never fills a gap. The login page's provider buttons
(shown before anyone types an email) list only these env apps; a school's own
providers are offered after the user types their email ("Continue").

The routes (see `backend/src/school/README.md` and
`backend/src/organisation/README.md`):

- school admin (`school:update`, active school):
  `GET /api/schools/current/sso/providers`,
  `PUT /api/schools/current/sso/providers/:key`, and the
  `/api/schools/email-domains` routes;
- organisation admin (any school; 404 for an unknown one):
  `GET /api/organisation/schools/:id/sso/providers`,
  `PUT /api/organisation/schools/:id/sso/providers/:key`,
  `GET/POST /api/organisation/schools/:id/email-domains`,
  `PATCH/DELETE .../email-domains/:domainId`,
  `POST .../email-domains/:domainId/verify`, and
  `GET /api/organisation/sign-in/domains` (every school's domains).

Provider items are `{ key, label, kind, enabled, available, configSource,
clientId, hasSecret, secretSource, settings, redirectUri, saml, notes, ... }`;
the PUT body is `{ enabled?, clientId?, clientSecret?, settings? }` (secret
write-only, `""` clears a field).

Env-only setup (fallback):

```env
# backend/.env
API_URL=https://api.example.com     # redirect URIs are built from this
SSO_PROVIDERS=google,azure          # env apps for schools without their own
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
# SAML_SP_ENTITY_ID=               # default: ${API_URL}/api/auth/sso/saml/metadata
# MOBILE_SSO_RETURN_URL=gradebook://sso
```

The redirect URI for both OpenID providers is
`${API_URL}/api/auth/sso/callback` (locally
`http://localhost:3001/api/auth/sso/callback`) - the same for every school.

### Google Workspace

1. Google Cloud console (the school's own project) > APIs & Services >
   OAuth consent screen: set it up (*Internal* is enough for the school's
   Workspace; an install-wide env app must be *External*).
2. Credentials > Create credentials > OAuth client ID > *Web application*.
3. Authorised redirect URI: `${API_URL}/api/auth/sso/callback`.
4. Paste the client ID and secret into the Google row of the school's
   Sign-in apps and switch it on - or, as an install-wide fallback, set
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and add `google` to
   `SSO_PROVIDERS`.

The issuer is `https://accounts.google.com`. Sign-in asks Google for the
account on the school's domain (`hd`, `login_hint`, `prompt=select_account`).
A Google sign-in vouches for a school domain only when the account belongs to
that school's Workspace: `email_verified` is true and the token's `hd` claim
is the domain or a parent of it. Personal Google accounts get signed in but
not placed in a school.

### Microsoft 365 / Entra ID

1. Azure portal > Microsoft Entra ID > App registrations > New registration.
   Supported account types: *Accounts in this organizational directory
   only* is enough for a school's own app (sign-in always goes to the
   school's tenant); an install-wide env app must be multitenant.
2. Redirect URI, platform *Web*: `${API_URL}/api/auth/sso/callback`.
3. Certificates & secrets > New client secret.
4. Paste the application (client) ID and the secret value into the
   Microsoft row of the school's Sign-in apps and switch it on - or, as an
   install-wide fallback, set `MICROSOFT_CLIENT_ID` /
   `MICROSOFT_CLIENT_SECRET` and add `azure` to `SSO_PROVIDERS`.

Each school admin enters their **tenant ID** on the email domain (Entra ID >
Overview > Tenant ID). Every Microsoft sign-in goes to that school's own
authority, `https://login.microsoftonline.com/<tenant>/v2.0` - never
`common` - so the ID token's issuer is checked strictly and accounts from
other tenants cannot sign in through it at all. That is why the user must
type their school email first ("Enter your school email to sign in with
Microsoft" otherwise).

Microsoft does not guarantee the email of an arbitrary account is verified
(any tenant admin can put any address on a user - "nOAuth"), so a Microsoft
sign-in vouches for a domain only when its `tid` is that domain's tenant and
the address is on the domain. "Require single sign-on" with Microsoft cannot
be switched on without a tenant ID.

### SAML (ADFS, Okta, ClassLink, Google Workspace SAML, Entra SAML, ...)

SAML needs no app and no switch: each school connects its own IdP on its
email domain (from its dashboard, or by an organisation admin from the
school's page in the console). There is **one SAML service provider for the
install** (one entity ID and ACS URL); per-school entity IDs would break
every IdP already set up with it, so each school's IdP gets the same SP
details and the assertion is checked against that domain's own certificate
and issuer.

What the school gives its IdP (shown on the admin page):

| | |
| --- | --- |
| Metadata URL | `${API_URL}/api/auth/sso/saml/metadata` |
| Entity ID (audience) | the same URL, unless `SAML_SP_ENTITY_ID` is set (the domain page shows the API's value) |
| ACS (reply) URL | `${API_URL}/api/auth/sso/saml/acs` (HTTP-POST) |
| NameID | the user's email address (persistent or email format preferred) |
| Attributes | optional: `givenName`/`sn`, `firstName`/`lastName`, or the `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/{givenname,surname,emailaddress}` claims |

What the school enters on its email domain:

- **SAML sign-on URL** - the IdP's SSO endpoint (must be `https://`).
- **IdP entity ID** - checked as the assertion's issuer.
- **Signing certificate** - the IdP's X.509 signing certificate, PEM or the
  bare base64 body. Assertions must be signed with it.

Assertions must be signed (a signature on the response alone is not
enough). The subject is stored per domain (`<domain id>:<NameID>`), so one
school's IdP can never assert another school's users. A SAML sign-in vouches
for exactly the domain whose certificate verified it, and only for addresses
on that domain.

Setting the provider to SAML, or requiring it, is refused until all three
fields are set and valid. If a school changes its IdP certificate, update
it on the admin page before the old one stops being used.

## School settings

Admin > Email Domains, on a verified domain (`PATCH /api/schools/email-domains/:id`;
needs a [step-up confirmation](#protecting-sso-settings)):

- **Sign-in provider** (`ssoProvider`) - which provider the school uses.
- **Microsoft tenant ID** (`azureTenantId`) - required for Microsoft.
- **SAML connection** (`samlEntryPoint`, `samlIssuer`, `samlCertificate`) -
  required for SAML; can be sent together with `ssoProvider: "saml"` in one
  request.
- **Require single sign-on** (`ssoRequired`) - email codes are refused for
  the domain, so disabling someone's school account ends their access here.
  Can only be switched on once the domain is verified and the provider is set
  up. A required provider that the school turns off, or that is not fully
  set up, does not lock anyone out: email codes work again.

## Protecting SSO settings

Single sign-on settings decide who can sign in as whom: whoever can point a
domain at an identity provider they control (a SAML entry point and
certificate, a Microsoft tenant, or the school's own Google / Microsoft app)
can sign in as anyone on that domain. School admins and organisation admins
can both change them, so every change is guarded three ways.

### Confirm it's you (step-up)

Every route that changes SSO settings needs a recent confirmation: adding,
editing, verifying or removing an email domain, and saving a sign-in app -
from the school's settings and from the organisation console alike. Reads
never do.

- Without one the API answers `403 { "code": "STEP_UP_REQUIRED", "message":
  "Confirm it's you to change single sign-on settings." }`.
- `POST /api/auth/step-up/send` emails an 8-digit code to the **signed-in
  user's own address**; `POST /api/auth/step-up/verify` with `{ "code" }`
  confirms it. The session that confirmed (only that one) may then change
  SSO settings for **10 minutes** (`account.session.elevated_until`).
- Step-up codes are ordinary email codes with their own purpose: same
  expiry (5 minutes, single use), send caps and per-client attempt limits
  as sign-in codes, counted separately, and not interchangeable - a sign-in
  code cannot confirm a change and a step-up code cannot sign in.
- On the web, the SSO section's requests opt in (`api(path, { stepUp: true
  })`): a `STEP_UP_REQUIRED` answer opens the "Confirm it's you" dialog,
  which sends the code straight away and retries the original request once
  the code is verified. The mobile app cannot change SSO settings.
- Development: with `ALLOW_DEV_LOGIN=true` (never in production),
  `POST /api/auth/dev/step-up-code` returns a code for the signed-in user
  instead of mailing it, like `POST /api/auth/dev/code` does for sign-in.

### Audit log

Every change is written to `public.sso_audit_log` in the same database
transaction as the change, so there is an entry exactly when the change
happened: who (`actor`), from which console (`actorVia`: `school_admin` or
`organisation_admin`), which domain, and what changed as `{ field: {
before, after } }`. Secrets never reach the log: SAML certificates are
recorded as SHA-256 fingerprints (as identity providers display them), client
secrets only as `set` / `cleared`. Entries outlive the domain and the
account; they go with the school.

| Action | When |
| --- | --- |
| `domain_added`, `domain_removed`, `domain_verified` | A domain is added, removed (with what it was set to), or verified |
| `domain_settings_changed` | Audience, auto-join or staff role |
| `provider_changed`, `sso_required_changed`, `azure_tenant_changed`, `saml_changed` | A domain's sign-in settings |
| `app_enabled`, `app_disabled`, `app_changed`, `app_secret_changed` | A school's Google / Microsoft app: on/off, client ID or settings, secret |

Read it under **Single sign-on > Activity** (school settings, and each
school's page in the organisation console), or from the API, newest first,
50 at a time (`limit` up to 200, `before` = the id of the last entry shown):

- `QUERY /api/schools/current/sso/audit` - the school's admin, active school.
- `QUERY /api/organisation/schools/:id/sso/audit` - organisation admins, any school.

Both take `{ "limit": 1-200 (default 50), "before": "<last entry id>" }` as a JSON body (see [HTTP QUERY](./backend/http-query.md)).

### Alert emails

After a change commits, the school's admin and every organisation admin
(`public.organisation_admin`, plus accounts with a verified email in
`ORG_ADMIN_EMAILS`) get one "Single sign-on settings changed for <School>"
email per request - the person who made the change included, as
confirmation. It says who, when and what changed (field names, values,
certificate fingerprints - never secrets) and links to the school's
single sign-on settings (`FRONTEND_URL`'s first origin +
`/dashboard/settings` for the school's admin, the school's organisation
page for organisation admins). It is sent for:

- the SAML sign-on URL, entity ID or certificate;
- a domain's sign-in provider or Microsoft tenant;
- **Require single sign-on** turned off;
- a sign-in app's client ID or secret, or the app turned on or off.

Without SMTP the alert is skipped (and logged); a failed send is logged and
never fails the change.

## Adding another provider

Providers are adapters (`backend/src/sso/sso.types.ts`):

```ts
interface SsoAdapter {
  id: string;            // stored on school_email_domain.sso_provider and account.identity
  label: string;         // "Continue with <label>"
  kind: 'oauth' | 'saml';
  adminLabel?: string; adminNotes?: string;     // the school's Sign-in apps row
  needsClient: boolean;                         // OAuth client ID + secret?
  settingFields: SsoSettingField[];             // non-secret per-school settings
  envConfig(): SsoProviderConfig;               // the install-wide env fallback
  available(config): boolean;                   // switched on + complete credentials
  readyFor(domain): boolean;                    // has this school set it up?
  start(ctx): Promise<{ url, secrets }>;        // ctx.config = this school's app
  complete(ctx): Promise<SsoIdentity>;          // same school's app as start
  profileFrom(claims): SsoProfile;              // names from claims/attributes
  vouchesForDomain(identity, domain): boolean;  // may this sign-in join a school?
  verifiesEmail?(identity): boolean;            // may it link by address?
}
```

For any OpenID Connect provider, extend `OidcAdapter`, which does discovery,
PKCE, state, nonce and ID token validation:

```ts
// backend/src/sso/adapters/keycloak.adapter.ts
export class KeycloakAdapter extends OidcAdapter {
  constructor() {
    super({
      id: 'keycloak',
      label: 'Keycloak',
      clientIdEnv: 'KEYCLOAK_CLIENT_ID',
      clientSecretEnv: 'KEYCLOAK_CLIENT_SECRET',
      adminNotes: 'Create a confidential client in your realm ...',
    });
  }

  protected issuerFor(): string {
    return process.env.KEYCLOAK_ISSUER!; // https://sso.example.com/realms/school
  }

  // Only return true for claims that prove the address belongs to the
  // school - e.g. a realm you control. When unsure, leave the default
  // (false): users still sign in, they just are not placed in a school.
  vouchesForDomain(identity: SsoIdentity, ctx: SsoDomainContext): boolean {
    return false;
  }
}
```

Register it in `createAdapters()` in `backend/src/sso/sso.registry.ts` and
register the redirect URI `${API_URL}/api/auth/sso/callback` with the
provider. It then gets a row in every school's Sign-in apps (allow its id in
`school_sso_provider`'s `provider` CHECK with a migration), where a school
enters its client ID and secret; env vars plus `SSO_PROVIDERS` remain the
install-wide fallback. Read credentials from `ctx.config` in `start` /
`complete`, never `process.env` directly, so each school's app applies. The
login pages and the admin screens read the lists from the API, so no
frontend change is needed.

`vouchesForDomain` is the security boundary: it decides whether an identity
from that provider may join a school by its email domain. Base it on
something the provider guarantees and the school controls (a hosted-domain
claim, a tenant id checked against the issuer, a certificate the school
configured), never on the email claim alone.

## Testing locally

`backend/src/test/saml-idp.ts` is a pretend IdP: two throwaway keypairs and a
`buildSamlResponse()` that signs assertions like a real one. The SSO unit
tests use it, and it is handy for a manual round trip: put `TEST_IDP.cert` on
a demo domain, start `/api/auth/sso/saml/start?email=...`, read the request
id from the inflated `SAMLRequest`, and post a built response with that
`InResponseTo` to the ACS.
