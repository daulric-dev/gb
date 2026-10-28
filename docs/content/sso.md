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

## Turning on a provider

Every provider needs its id in `SSO_PROVIDERS`; Google and Microsoft also
need their client credentials. `GET /api/auth/sso/providers` lists only what
is configured, and the login pages and admin picker read that list.

```env
# backend/.env
API_URL=https://api.example.com     # redirect URIs are built from this
SSO_PROVIDERS=google,azure,saml
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
# SAML_SP_ENTITY_ID=               # default: ${API_URL}/api/auth/sso/saml/metadata
# MOBILE_SSO_RETURN_URL=gradebook://sso
```

The redirect URI for both OpenID providers is
`${API_URL}/api/auth/sso/callback` (locally
`http://localhost:3001/api/auth/sso/callback`).

### Google Workspace

1. Google Cloud console > APIs & Services > OAuth consent screen: set it up
   (External, so every school's Workspace can sign in).
2. Credentials > Create credentials > OAuth client ID > *Web application*.
3. Authorised redirect URI: `${API_URL}/api/auth/sso/callback`.
4. Put the client ID and secret in `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET`, and add `google` to `SSO_PROVIDERS`.

The issuer is `https://accounts.google.com`. Sign-in asks Google for the
account on the school's domain (`hd`, `login_hint`, `prompt=select_account`).
A Google sign-in vouches for a school domain only when the account belongs to
that school's Workspace: `email_verified` is true and the token's `hd` claim
is the domain or a parent of it. Personal Google accounts get signed in but
not placed in a school.

### Microsoft 365 / Entra ID

1. Azure portal > Microsoft Entra ID > App registrations > New registration.
   Supported account types: *Accounts in any organizational directory*
   (multitenant), so every school's tenant can sign in.
2. Redirect URI, platform *Web*: `${API_URL}/api/auth/sso/callback`.
3. Certificates & secrets > New client secret.
4. Put the application (client) ID and the secret in `MICROSOFT_CLIENT_ID` /
   `MICROSOFT_CLIENT_SECRET`, and add `azure` to `SSO_PROVIDERS`.

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

Add `saml` to `SSO_PROVIDERS`. Nothing else is configured by the platform
operator: each school connects its own IdP from the admin page.

What the school gives its IdP (shown on the admin page):

| | |
| --- | --- |
| Metadata URL | `${API_URL}/api/auth/sso/saml/metadata` |
| Entity ID (audience) | the same URL, unless `SAML_SP_ENTITY_ID` is set |
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

Admin > Email Domains, on a verified domain (`PATCH /api/schools/email-domains/:id`):

- **Sign-in provider** (`ssoProvider`) - which provider the school uses.
- **Microsoft tenant ID** (`azureTenantId`) - required for Microsoft.
- **SAML connection** (`samlEntryPoint`, `samlIssuer`, `samlCertificate`) -
  required for SAML; can be sent together with `ssoProvider: "saml"` in one
  request.
- **Require single sign-on** (`ssoRequired`) - email codes are refused for
  the domain, so disabling someone's school account ends their access here.
  Can only be switched on once the domain is verified and the provider is set
  up. A required provider that the deployment turns off, or that is not fully
  set up, does not lock anyone out: email codes work again.

## Adding another provider

Providers are adapters (`backend/src/sso/sso.types.ts`):

```ts
interface SsoAdapter {
  id: string;            // stored on school_email_domain.sso_provider and account.identity
  label: string;         // "Continue with <label>"
  kind: 'oauth' | 'saml';
  isEnabled(): boolean;                         // credentials present + in SSO_PROVIDERS
  readyFor(domain): boolean;                    // has this school set it up?
  start(ctx): Promise<{ url, secrets }>;        // provider sign-in URL
  complete(ctx): Promise<SsoIdentity>;          // check the response
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

Register it in `backend/src/sso/sso.registry.ts`, register the redirect URI
`${API_URL}/api/auth/sso/callback` with the provider, set its env vars and
add its id to `SSO_PROVIDERS`. The login pages and the admin picker read the
list from `GET /api/auth/sso/providers`, so no frontend change is needed.

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
