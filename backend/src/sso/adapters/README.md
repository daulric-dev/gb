# SSO adapters (`src/sso/adapters`)

One class per sign-in provider, each implementing `SsoAdapter` from [`../sso.types.ts`](../sso.types.ts). An adapter builds the provider's sign-in URL (`start`), checks what comes back (`complete`), turns claims or attributes into a profile (`profileFrom`), and - most importantly - decides whether the provider vouches that the user owns an address at a school's domain (`vouchesForDomain`). `SsoService` does everything else (state, cookies, accounts, sessions).

Adapters are instantiated once in [`../sso.registry.ts`](../sso.registry.ts). They are plain classes, not Nest providers, and read their configuration from `process.env` when called.

## Files

| File | Defines | What it does |
| --- | --- | --- |
| `oidc.adapter.ts` | `abstract class OidcAdapter`, `OidcAdapterOptions` | Generic OpenID Connect: discovery (cached per issuer, retried after a failure), authorization code flow with PKCE S256, `state` and `nonce`, and ID token validation by `openid-client`. Enabled when its id is in `SSO_PROVIDERS` and both credential env vars are set. Subclasses supply `issuerFor(ctx)` and optionally `authorizationParams(ctx)`, `emailFrom()`, `readyFor()`. Never vouches for a domain by default. |
| `google.adapter.ts` | `GoogleAdapter` (id `google`) | Google Workspace / Google for Education and personal Google accounts. Issuer `https://accounts.google.com`; sends `prompt=select_account`, `login_hint` and `hd`. Vouches for a domain only when the email is verified, is on that domain, and the token's `hd` claim is the domain or a parent of it. `verifiesEmail` is true for Gmail addresses and the Workspace's own domain. Env `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. |
| `azure.adapter.ts` | `AzureAdapter` (id `azure`, label "Microsoft"), `tenantIssuer()` | Microsoft 365 / Entra ID. Always signs in against the school's own tenant (`https://login.microsoftonline.com/<tenant>/v2.0`), never `common`, so the user must type their school email first. `readyFor` needs a valid tenant GUID on the domain. Vouches only when the token's `tid` (and `iss`) match the domain's recorded tenant. Falls back to `preferred_username` for the email. Env `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`. |
| `saml.adapter.ts` | `SamlAdapter` (id `saml`), `normalizeCertificate()` | SAML 2.0 with any IdP (ADFS, Okta, ClassLink, Google or Entra SAML, Shibboleth). Each school configures its IdP on its email domain (SSO URL, IdP entity ID, signing certificate). SP-initiated: sends an AuthnRequest with `RelayState` = our state and accepts only a response to that request id, with a signed assertion from that school's certificate and issuer, for our audience, within 60 s clock skew. Subjects are namespaced as `<domainId>:<nameID>` (or the email for transient NameIDs). Vouches only for the domain whose configuration verified the assertion. Also produces the SP metadata. `normalizeCertificate()` accepts PEM or bare base64 and returns PEM, or null if it is not X.509. |
| `profile.ts` | `claimString()`, `standardProfile()` | Shared helpers: first non-empty string claim (first item of a list), and first/last name and picture from standard claims (or named SAML attributes), splitting a full name when needed. Only `https://` pictures are kept. |

## How to add an SSO provider

The full walkthrough with an example is in [docs/content/sso.md - Adding another provider](../../../../docs/content/sso.md#adding-another-provider). In short:

1. **Write the adapter here.** For an OpenID Connect provider, extend `OidcAdapter`:

   ```ts
   export class KeycloakAdapter extends OidcAdapter {
     constructor() {
       super({
         id: 'keycloak',                // stored on school_email_domain.sso_provider and account.identity.provider
         label: 'Keycloak',             // "Continue with Keycloak"
         clientIdEnv: 'KEYCLOAK_CLIENT_ID',
         clientSecretEnv: 'KEYCLOAK_CLIENT_SECRET',
       });
     }
     protected issuerFor(): string {
       return process.env.KEYCLOAK_ISSUER!;
     }
   }
   ```

   For any other protocol, implement `SsoAdapter` directly (see `SamlAdapter`): `isEnabled`, `readyFor`, `start`, `complete`, `profileFrom`, `vouchesForDomain`, and optionally `verifiesEmail`.

2. **Decide `vouchesForDomain` carefully.** It decides whether a sign-in may join a school by email domain. Base it on something the provider guarantees and the school controls (a hosted-domain claim, a tenant id checked against the issuer, a certificate the school configured) - never on the email claim alone. If unsure, keep the default `false`: users can still sign in, they just are not placed in a school automatically. `verifiesEmail` likewise must only return true for addresses the provider really controls; it allows linking to an existing account with that address.

3. **Register it** by adding `new KeycloakAdapter()` to `ADAPTERS` in [`../sso.registry.ts`](../sso.registry.ts).

4. **Configure it:** register `${API_URL}/api/auth/sso/callback` as the redirect URI at the provider, set its env vars, add its id to `SSO_PROVIDERS`, and document the variables in `backend/.env.example` and [docs/content/environment-variables.md](../../../../docs/content/environment-variables.md).

5. **Test it** in [`../sso.test.ts`](../sso.test.ts) alongside the Google, Azure and SAML cases: what `vouchesForDomain` and `verifiesEmail` accept and refuse.

No frontend change is required: the login pages and the admin picker read the list from `GET /api/auth/sso/providers`, and `start` URLs are built from the adapter id. The only optional extra is a brand icon - `frontend/components/auth/sso-provider-icon.tsx` draws logos for `google` and `azure` and a generic icon for anything else.
