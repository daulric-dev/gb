# Two-step verification (`src/mfa`)

Authenticator-app (TOTP) two-step verification: setting it up, recovery
codes, the code step at sign-in, the organisation policy that makes it
compulsory for privileged roles, the enrolment gate, and admin resets. The
user guide is [docs/content/guide/two-factor.md](../../../docs/content/guide/two-factor.md).

## What it provides

- **HTTP routes** (`mfa.controller.ts`), below.
- **Services / exports** (`MfaModule` is global):
  - `MfaService.startSession(reply, req, userId, method)`: called by the
    email-code sign-in (`AuthService`) and the mobile single sign-on
    hand-off (`SsoService`) in place of `SessionService.create`. Opens the
    session, or throws 403 `MFA_REQUIRED` with a challenge token.
  - `MfaService.finishWebSignIn(...)`: the browser single sign-on callback's
    version; returns where to send the browser (the destination, or
    `/login/two-step?token=...&next=...` when a code is needed).
  - `MfaService.assertSessionAllowed(request)`: called by `AuthGuard` on every
    authenticated request; enforces the enrolment gate.
  - `mfa.policy.ts`: `mfaRequiredForAdmins`, `holdsPrivilegedRole`,
    `mfaRequiredFor`.
  - `totp.ts`: RFC 6238 TOTP on `node:crypto` (HMAC-SHA-1, 6 digits, 30-second
    steps, one step either side accepted), base32, the `otpauth://` URI, and
    recovery codes.

## Routes

User routes need a session (`AuthGuard`) except `verify`. "Step-up" means the
session must have confirmed an emailed code in the last ten minutes
(`RequireStepUp`, `src/auth/step-up.guard.ts`); it is an emailed code, not the
authenticator.

| Method | Path | Step-up | Throttle | What |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/mfa/verify` | - (no session yet) | 10/min per route | `{ token, code }` or `{ token, recoveryCode }`. Finishes a challenged sign-in and sets the session like `/auth/otp/verify`. Returns `{ signedIn, recoveryCodeUsed, recoveryCodesRemaining }`. |
| GET | `/api/auth/mfa` | - | - | `{ enabled, enabledAt, recoveryCodesRemaining, required, enrolmentRequired }`. `required`: the organisation policy covers this user. `enrolmentRequired`: this session is gated. |
| POST | `/api/auth/mfa/enrol` | yes | 10/hour | A new secret, kept as *pending*: `{ secret, otpauthUri, issuer, account }`. An active app keeps working until the new one is confirmed. |
| POST | `/api/auth/mfa/enrol/confirm` | - | 10/15 min | `{ code }` from the new app, within 15 minutes of `enrol`. Activates it, replaces all recovery codes with ten new ones (returned once), clears the user's enrolment gates, emails the user. |
| POST | `/api/auth/mfa/recovery-codes` | yes | 5/hour | Ten new recovery codes; the old ones stop working. |
| POST | `/api/auth/mfa/disable` | yes | 10/15 min | `{ code }` or `{ recoveryCode }`. Removes the app and the codes, emails the user. 409 while the organisation policy covers the user (they can replace the app instead). |
| GET | `/api/organisation/mfa-policy` | - | - | Organisation admins: `{ requireMfaForAdmins }`. |
| PATCH | `/api/organisation/mfa-policy` | yes | - | Organisation admins: `{ requireMfaForAdmins: boolean }`. Audited (`organisation`, `require_mfa_for_admins` before/after). |
| POST | `/api/organisation/users/:userId/mfa/reset` | yes | 20/hour | Organisation admins: remove a user's app and recovery codes (lost phone). 404 if they have none. Emails the user, naming the admin. |

The web console shows the reset button next to organisation admins
(**Organisation → Admins**) and each school's admin (**Organisation →
Schools → a school**); for anyone else, call the route.

## Sign-in flow

1. The first factor succeeds: an emailed code (`method` `email-code`) or a
   single sign-on callback (`method` = the provider id).
2. `challengeFor(userId, method)` decides whether a code is needed:
   - the user has an active app, **and**
   - the method is `email-code`, **or** the organisation policy covers the
     user. A single sign-on user who is not covered is never asked for the
     code; the identity provider's own multi-factor policy applies.
3. If a code is needed, a random 32-byte token is cached for 5 minutes
   (`CHALLENGE_TTL_S`; the cache key is its SHA-256) and returned: as 403
   `{ code: 'MFA_REQUIRED', mfaToken, expiresIn }` to API clients, or in the
   `/login/two-step` URL for the browser single sign-on flow. The web app
   keeps it in `sessionStorage` (`gb_mfa_challenge`) and removes it as soon as
   the code page reads it.
4. `POST /auth/mfa/verify` checks the code (or recovery code), marks the
   challenge used (single use, also against two parallel requests), resets
   the failure counter and opens the session. Every outcome is audited (below).

### Codes and replay

- A code is accepted for the current 30-second step or one step either side.
- The step of the last accepted code is stored (`last_used_step`); that step
  and earlier ones are never accepted again, and the update is conditional,
  so two requests with one code cannot both pass.
- Recovery codes: ten per user, `xxxxx-xxxxx` from a 31-symbol alphabet
  without look-alike characters (about 49.5 bits each). Stored as SHA-256
  hashes only; each works once. Case, spaces and hyphens are ignored when
  entered. Using one emails the user (device, IP address, codes left).

### Lockout

- One challenge takes 5 wrong codes (`MAX_CHALLENGE_ATTEMPTS`), then it is
  dropped and the user starts sign-in again.
- 10 wrong codes in a row across challenges (`MAX_FAILED_ATTEMPTS`) lock the
  account's codes for 15 minutes (`LOCKOUT_MS`): verify answers 429
  `MFA_LOCKED`. A correct code resets the counter. The emailed-code step has
  its own throttling in `src/auth`.

## Organisation policy and the enrolment gate

`organisation.require_mfa_for_admins` (default **true**; migration
`20261205180000_require_admin_mfa` also turned it on for existing
organisations). It covers (`holdsPrivilegedRole`) organisation admins, school
admins (`school_management.role = 'admin'`), and members whose built-in role
or a custom role grants `pastoral-note:safeguarding` in any school.

What it does, exactly:

- **Covered user with an app:** asked for a code at every new sign-in, by
  emailed code or single sign-on. Cannot turn the app off (409); can replace
  it.
- **Covered user without an app, signing in with an emailed code:** the new
  session gets an `account.mfa_enrolment_gate` row. `AuthGuard` then answers
  403 `MFA_ENROLMENT_REQUIRED` on every route except `/auth/me`,
  `/auth/logout`, `/auth/mfa/*` and step-up (`GATE_ALLOWED`). Confirming an
  app removes every gate of the user. The gate check is cached for 60
  seconds per session.
- **Covered user without an app, signing in with single sign-on:** not gated.
  They get a normal session and rely on the identity provider's MFA.
- **Sessions that already exist** when the policy is turned on, or when a
  user is given a covered role, are not gated or challenged; the policy
  applies from the next sign-in. Staff sessions end after
  `STAFF_SESSION_IDLE_HOURS` without use and `STAFF_SESSION_MAX_DAYS` at most
  (`src/account/session.config.ts`). To apply it at once, sign the people
  concerned out (**Organisation → Admins** / a school: *Sign out sessions*).
- Step-up confirmations use an emailed code, not the authenticator.
- Anyone can set up an app voluntarily; then emailed-code sign-ins always
  ask for it.

## Admin reset

`POST /organisation/users/:userId/mfa/reset` deletes the user's
`mfa_totp` and `mfa_recovery_code` rows. They sign in with an emailed code
again; if the policy covers them, that session is gated until they set up a
new app. The user is emailed. Only organisation admins can reset; school
admins cannot. Check the person's identity out of band before resetting.

## Audit and email

Organisation-scope `audit_log` entries, `entity: 'user_mfa'`, `entity_id` the
user, `changes.event` one of: `enabled`, `replaced`, `disabled`,
`recovery_codes_regenerated`, `reset_by_admin` (actor: the admin),
`sign_in_verified`, `sign_in_recovery_code`, `sign_in_failed`,
`sign_in_locked` (with the sign-in `method`). A failed audit write is logged
and does not block sign-in.

Emails (when SMTP is configured; failures are logged): app turned on or
replaced, turned off, a recovery code used, reset by an admin.

## Data

| Table | What |
| --- | --- |
| `account.mfa_totp` | One row per user: active secret and pending secret, both sealed with `secret-box` (AES-256-GCM, HKDF info `gradebook:mfa-totp:v1`, AAD the user id, keyed from `DATA_ENCRYPTION_KEY`), `enabled_at`, `last_used_step`, `failed_attempts`, `locked_until`. |
| `account.mfa_recovery_code` | SHA-256 hashes and `used_at`. |
| `account.mfa_enrolment_gate` | Gated sessions; cascades with the session. |
| `public.organisation.require_mfa_for_admins` | The policy. |

All three `account` tables cascade when the account is deleted. Data exports
include safe metadata only (`account-security`: whether an app is on, when,
how many recovery codes are left); secrets and hashes never leave the server.

A secret that no longer decrypts (the key changed) is logged and treated as
no match, so the user cannot sign in with codes: reset them. `bun run
secrets:reencrypt` does not yet move authenticator secrets from
`AUTH_SECRET` (`v1:`) to `DATA_ENCRYPTION_KEY`; an install that stored them
before setting `DATA_ENCRYPTION_KEY` must not rotate `AUTH_SECRET` until
those users have set up their app again or been reset.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `MFA_ISSUER` | `GradeBook` | The issuer name in the `otpauth://` URI (what the authenticator app shows). |
| `DATA_ENCRYPTION_KEY` | - (required in production) | Keys the sealed secrets. |

## Tests

`mfa.service.test.ts` (sign-in challenge, gate, lockout, policy, reset,
audit), `totp.test.ts` (RFC 6238 vectors, replay window, recovery codes).
