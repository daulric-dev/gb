---
label: Single Sign-On
---

# Single sign-on

Students and staff can sign in with their school's Google Workspace, Microsoft
365 or SAML identity provider instead of an emailed code. When the provider
vouches for a school's verified email domain, the first sign-in creates the
account and puts the user in the school - nobody fills in a form.

## How sign-in works

1. The user types their email on the login page.
2. The app calls `GET /api/auth/sso/discover?email=`. If the address's school
   has a provider set, the app offers it; if the school **requires** it, the
   app sends the browser straight to the provider and no email code is sent.
3. `GET /api/auth/sso/<provider>/start` asks Supabase Auth for the provider's
   sign-in URL (PKCE; the verifier is kept in a cookie on the API's domain)
   and redirects there.
4. The provider sends the browser back to `GET /api/auth/sso/callback`, which
   exchanges the code for a session, creates or completes the profile, joins
   the school when the domain is vouched for, and redirects to the web app.
   The mobile app instead receives `gradebook://sso?code=<one-time code>` and
   redeems it with `POST /api/auth/sso/handoff`, because the system browser's
   cookies never reach the app.

## Turning on a provider

Every provider needs two switches: Supabase Auth must have it configured, and
the API must list it in `SSO_PROVIDERS`.

```env
# backend/.env
SSO_PROVIDERS=google,azure,saml
API_URL=https://api.example.com   # the callback is built from this
```

Allow the callback as a redirect in Supabase: locally it is already in
`supabase/config.toml` (`additional_redirect_urls`); on the hosted project add
`https://api.example.com/api/auth/sso/callback` under Authentication > URL
Configuration.

### Google Workspace

1. Google Cloud console > APIs & Services > Credentials > Create OAuth client
   ID (Web application).
2. Authorised redirect URI: `https://<project>.supabase.co/auth/v1/callback`
   (locally `http://127.0.0.1:54321/auth/v1/callback`).
3. Put the client ID and secret in Supabase: Authentication > Providers >
   Google, or locally set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` /
   `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` and `enabled = true` under
   `[auth.external.google]`.

A Google sign-in vouches for a school domain only when the account belongs
to that school's Workspace (the token's `hd` claim is the domain or a parent
of it). Personal Google accounts get signed in but not placed in a school.

### Microsoft 365 / Entra ID

1. Azure portal > Microsoft Entra ID > App registrations > New registration.
   Supported account types: *Accounts in any organizational directory*
   (multitenant), so every school's tenant can sign in.
2. Redirect URI (Web): the same Supabase callback as above.
3. Certificates & secrets > New client secret.
4. Supabase: Authentication > Providers > Azure, URL
   `https://login.microsoftonline.com/common/v2.0`; locally
   `SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID` / `_SECRET` and
   `[auth.external.azure] enabled = true`.

Microsoft does not guarantee the email of an arbitrary account is verified,
so each school admin enters their **tenant ID** on the email domain (Entra ID
> Overview > Tenant ID). Only sign-ins from that tenant join the school, and
"Require single sign-on" with Microsoft cannot be switched on without it.

### SAML (ADFS, Okta, ClassLink, Shibboleth, ...)

SAML needs Supabase's SSO feature (Pro plan). The platform operator registers
each school's identity provider against its domains:

```bash
supabase sso add --type saml --project-ref <ref> \
  --metadata-url https://idp.school.example/metadata \
  --domains srmss.edu.gd
```

Map attributes so names arrive as `given_name` / `family_name`
(`supabase sso update <id> --attribute-mapping-file mapping.json`). Then add
`saml` to `SSO_PROVIDERS` and the school admin picks "your school (SSO)" as
their domain's provider. Supabase only accepts SAML sign-ins for the domains a
provider was registered with, so a SAML sign-in vouches for its domain.

## School settings

Admin > Email Domains, on a verified domain:

- **Sign-in provider** - which provider the school uses.
- **Microsoft tenant ID** - required for Microsoft.
- **Require single sign-on** - email codes are refused for the domain, so
  disabling someone's school account ends their access here. Can only be
  switched on once the domain is verified and the provider is set up.

## Adding another provider

Providers are adapters (`backend/src/sso/sso.types.ts`):

```ts
interface SsoAdapter {
  id: string;            // stored on school_email_domain.sso_provider
  label: string;         // "Continue with <label>"
  kind: 'oauth' | 'saml';
  isEnabled(): boolean;
  start(input): Promise<string>;              // provider sign-in URL
  profileFrom(user): SsoProfile;              // names from the provider's claims
  vouchesForDomain(user, domain): boolean;    // may this sign-in join a school?
}
```

For any OAuth/OpenID provider Supabase Auth supports (Apple, Keycloak,
GitLab, ...), extend `SupabaseOAuthAdapter`:

```ts
// backend/src/sso/adapters/keycloak.adapter.ts
export class KeycloakAdapter extends SupabaseOAuthAdapter {
  constructor() {
    super({ id: 'keycloak', label: 'Keycloak', scopes: 'openid email profile' });
  }

  // Only return true for claims that prove the address belongs to the
  // school - e.g. a realm you control. When unsure, leave the default
  // (false): users still sign in, they just are not placed in a school.
  vouchesForDomain(user: User, ctx: SsoDomainContext): boolean {
    return false;
  }
}
```

Register it in `backend/src/sso/sso.registry.ts`, enable it in Supabase, and
add its id to `SSO_PROVIDERS`. The login pages and the admin picker read the
list from `GET /api/auth/sso/providers`, so no frontend change is needed.

`vouchesForDomain` is the security boundary: it decides whether an identity
from that provider may join a school by its email domain. Base it on a claim
the provider guarantees (a hosted-domain claim, a tenant id, a domain-bound
SAML connection), never on the email claim alone.
