---
sidebar_label: 2026-10-21 · School email domains and single sign-on
sidebar_position: 3
---

# 2026-10-21 - School email domains and single sign-on

Students and staff with a school email address can join their school - and sign in - without join codes, approvals or creating an account.

## School email domains

An admin lists the domains the school owns under **Admin > Email Domains**:

- **Students** - matching student accounts join automatically and get a roster record.
- **Staff** - join automatically as Teacher or Member, or file a join request for the admin (default).
- **Students and staff** - one shared domain (e.g. everyone `@srmss.edu.gd`). Students join automatically; staff follow the staff setting, which defaults to approval so choosing "staff" at sign-up cannot make a student a teacher.

A domain does nothing until **verified** with a DNS TXT record (`gradebook-verification=<token>`). A verified domain belongs to one school; public providers (gmail.com, outlook.com, ...) are refused; admin is never granted by domain. Matching is exact, so country domains like `srmss.edu.gd` and `smss.edu.gd` never collide, and nobody can claim all of `edu.gd`.

Joining happens at the end of onboarding; existing users without a school see "Your @domain address belongs to ... - Join" on the schools screen (web and app).

## Single sign-on

Sign in with **Google Workspace**, **Microsoft 365** or **SAML** (ADFS, Okta, ClassLink, ...). The login page asks for the email first and checks its domain:

- the school **requires** SSO → straight to the school's sign-in page, no email code;
- the school offers SSO → "Continue with Google/Microsoft", with an email code as a fallback;
- otherwise → email code as before.

On first sign-in the account is created from the provider's profile. When the provider vouches for a verified school domain, the user is placed in the school as student or staff with no form; shared domains ask "student or staff" once.

**What counts as vouching** (the security boundary):

| Provider | Vouches when |
| --- | --- |
| Google | The account belongs to the school's Workspace (`hd` claim = the domain or a parent) |
| Microsoft | The sign-in comes from the school's own tenant, entered on the domain. Guards against "nOAuth" (any tenant can set any email on its users) |
| SAML | Supabase SSO bound the identity provider to the domain |

A school that requires one provider refuses the others. "Require single sign-on" turns email codes off for the domain, so disabling an account at the school ends access here; it can only be switched on once the domain is verified and the provider is set up.

The mobile app signs in through the system browser and receives the session through a single-use, two-minute handoff code.

## Adapters

Providers are adapter classes in `backend/src/sso/adapters`. Adding one (Apple, Keycloak, ...) is one class extending `OAuthAdapter`, one line in `sso.registry.ts`, and its id in `SSO_PROVIDERS`; the login buttons and admin picker update themselves. See [Single sign-on](../../sso.md).

## Configuration

- Supabase: enable Google/Azure with client ID and secret (once per deployment, not per school), allow `<API_URL>/api/auth/sso/callback` as a redirect URL. SAML: Pro plan, `supabase sso add` per school.
- Backend: `SSO_PROVIDERS`, `API_URL`; local dev only: `ALLOW_UNVERIFIED_EMAIL_DOMAINS=true`.
- Mobile: native rebuild (`expo-web-browser`).

## Behaviour changes

- Onboarding no longer pre-selects "staff"; everyone chooses student or staff.
- `POST /api/auth/otp/send` and `/verify` return 403 for addresses whose school requires SSO.
- Login returns users to the page they came from (`?next=`, same-site paths only).

Migrations: `20261021140000_school_email_domains.sql`, `20261021150000_email_domain_any_audience.sql`, `20261021160000_school_sso.sql`.
