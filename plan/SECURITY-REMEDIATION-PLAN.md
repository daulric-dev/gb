# Security Remediation Plan

Date: 2026-11-15
Branch audited: `staging` (at `4143a89`)

## Status

Implemented on 2026-11-15, except where noted. Backend: 3369 tests pass,
`tsc --noEmit` clean, `eslint` clean. Frontend: 472 tests pass.

| | Finding | Outcome |
| --- | --- | --- |
| M1 | Cookie scoped to parent domain | Documented, boot warning added. Host-only `__Host-` cookie still deferred. |
| M2 | No global `AuthGuard` | Done. Guard is global; 26 public routes marked and pinned by a test. |
| M3 | `AUTH_COOKIE_SECURE=false` in production | Done. Refused at startup. |
| M4 | Session outliving its profile | **Withdrawn — not reachable.** See below. |
| M5 | `PermissionGuard` school fallback | Done. All 161 call sites annotated with an explicit scope. |
| L1 | `file_share` not school-scoped | Done. |
| L2 | Report links replayable | Done. Single use, needs a schema change (see below). |
| L3 | `/health` detail public | Done. |
| L4 | 24-hour lost-rotation grace | Done. One hour, configurable, and it emails the account. |
| L5 | `WEBHOOK_ALLOW_PRIVATE` too broad | **Partly done.** Metadata/link-local now always blocked; per-destination config deferred. |

### Regular expressions

Nothing added by this work uses a regular expression with a quantifier. The
route-coverage test parses decorators with string operations, and
`health/health-peer.ts` takes addresses apart with `split` and number
comparisons. Both carry a comment saying why.

The shape to avoid is a repetition that can match the same text two ways, so a
non-matching input can be split many ways and the match time grows with its
length — what code scanning reports as CWE-1333. The first draft of the route
parser had it: `\(\s*(?:'([^']*)')?\s*\)` puts a group that can match nothing
between two `\s*`, so a run of spaces can be divided between them.

One pre-existing case was fixed with it: `stripEmails` in
`mail/mail.service.ts` used
`[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}` for the domain, where a
trailing `.abc` can be taken either by another turn of the group or by the
final part. It runs over SMTP error text, which the far end writes. It is now
a linear scan out from each `@`, matching what `ai/redact.ts` already does for
the same reason, with a test that a 5000-label input returns at once.

Checked and left alone: `rostering/roster-csv.ts:80`
(`/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/`) is unambiguous — `.` is excluded from
the character classes either side of the group, so no input can be split two
ways.

### Review of this work

The changes were reviewed against the same checklist afterwards, because the
risk they carry — authorization logic — is the one class no scanner in this
repo detects. CodeQL, Trivy, OSV, bun audit, TruffleHog and Snyk find known-bad
dependencies, leaked secrets and taint patterns; none of them can tell you a
route was marked public by mistake. Three defects were found in the new code
and fixed:

1. **`/health` was still public in the bundled topology.** The first version of
   `isInternalPeer` checked only the socket peer address. Caddy runs on the
   Compose network, so every request it relays from the internet has a private
   peer — the detail would have gone to everyone. A relayed request (one
   carrying `X-Forwarded-For`, `X-Real-IP`, `Forwarded` or `X-Forwarded-Host`)
   is now never internal.

2. **The new metadata block was bypassable with an IPv6 literal.**
   `isAlwaysBlocked` branched on address family, so `::ffff:169.254.169.254` —
   IPv4-mapped IPv6, which a dual-stack socket connects to 169.254.169.254 —
   missed both the IPv4 and the IPv6 lists and was allowed wherever
   `allowPrivate` is on (webhooks under `WEBHOOK_ALLOW_PRIVATE`, AI providers,
   custom OIDC). `new URL()` canonicalises the host to `[::ffff:a9fe:a9fe]`,
   so matching on the text would not have caught it either. The check now
   extracts the embedded IPv4 numerically and applies the IPv4 rules to it.

3. **The `stripEmails` rewrite under-redacted.** Dropping the regex changed
   the semantics: the old pattern was unanchored and would settle for a prefix
   of the domain, while the rewrite required the *last* label to be two or more
   letters and redacted nothing otherwise. Addresses at internationalised
   domains (`user@example.xn--p1ai`) and anything with a digit appended by a
   bounce message went into the logs in full. It now takes the longest domain
   prefix ending in a usable label, which reproduces the old outcome; a
   differential fuzz of 400k inputs against the old pattern shows no remaining
   case where it redacts less.

The reviewer separately confirmed, by diffing the `@UseGuards` multiset
against `HEAD`, that no route lost a guard, and that all five newly
`@Public()` controllers were already unauthenticated before this work.

### Before deploying

`bun run db:push` (or `db:deploy`) — L2 adds a `report_link_use` table.
Without it, every report link 500s on first use.

### M4 was withdrawn

The original finding said a session could outlive its `user_profile`. On a
closer check it cannot: the only code that deletes a profile
(`erasure/account-erasure.ts:131`) calls `sessions.revokeAll` first and deletes
the `app_user` row in the same transaction, and `SessionService.resolve`
already refuses a session whose `app_user` is gone or disabled. The guard's
comment claimed the null case failed closed, which was wrong; the comment was
corrected to state why allowing it is safe and what a future partial-deletion
path would have to do. No behaviour changed.

### L5 is only partly done

Shipped: link-local and cloud instance metadata (`169.254.0.0/16`, `fe80::/10`,
`fd00:ec2::/32`) are refused by `resolveWebhookDestinations` regardless of
`WEBHOOK_ALLOW_PRIVATE` or a per-request `allowPrivate`. This closed a real
hole: a school admin could previously point a custom OIDC issuer at
`169.254.169.254` by ticking "identity provider is on our private network",
and the adapter's own test asserted that this was allowed.

Not shipped: replacing the install-wide switch with a per-destination
`allow_private_network` column on webhooks, LTI tools and OneRoster sources.
That needs a migration and an admin UI field for each, which is a product
change rather than a fix. Phase 5 below still describes it.

## Scope and method

Audited by reading the code, not by running a scanner against a deployment:

- `backend/` — 1006 TypeScript files; roughly 40 security-critical files read in
  full (auth, session, permission, crypto, SSO/SAML, LTI, file access, SSRF
  guards, CSRF, startup config), the rest swept with targeted pattern searches.
- `frontend/` — `proxy.ts`, `lib/csp.ts`, `next.config.ts`, XSS sink search.
- `infrastructure/` — Caddyfile, Compose, security headers.
- `.github/workflows/` — expression injection and permissions.
- Dependencies — `bun audit`: 0 vulnerabilities across 1888 packages.

The codebase is already hardened to an unusual degree. SSRF resolution with
per-request DNS pinning, a CSRF origin check with reasoned exemptions, an
AES-256-GCM secret box with key separation and rotation, TOTP replay
protection, LTI JWT restricted to RS256, SAML with `wantAssertionsSigned` and
`validateInResponseTo` — all correct. The findings below are what remains.

### Verified clean

SQL injection (no `$queryRawUnsafe` reachable from user input — every call site
passes constants or bound parameters), command injection, weak crypto
(`Math.random` only in webhook backoff jitter; SHA-1 only in TOTP per RFC 6238
and in a Redis script hash), path traversal in image serving (regex-pinned
object paths), zip-slip, stored XSS on file download (`nosniff` plus
`Content-Security-Policy: sandbox`), JWT algorithm confusion, GitHub Actions
script injection (PR title reaches the script through `env:`, never `run:`),
secrets in git history (only `.env.example` files are tracked).

---

## Findings

Severity is relative to this codebase, which starts from a high baseline.

### Medium

**M1 — Session cookie scoped to the registrable parent domain.**
`backend/src/config/origins.ts`, `authCookieDomain()` derives `.example.com`
from `primaryOrigin()`. Every sibling subdomain (marketing site, status page,
user-content host, a stale CNAME) can read and overwrite `gb_session`. One XSS
or one subdomain takeover anywhere under that domain is full session theft, and
cookie-tossing lets an attacker pin a session value. `SameSite=Lax` does not
help — siblings are same-site.

**M2 — No global `AuthGuard`; authentication is fail-open by default.**
80 controllers, 75 carry `@UseGuards(AuthGuard, ...)`. The 5 without are
intentional today. But a new controller added without the decorator is
unauthenticated and nothing fails. `app.module.ts` registers only
`ThrottlerGuard` and `VersioningGuard` as `APP_GUARD`.

**M3 — `AUTH_COOKIE_SECURE=false` is honoured in production with no startup
refusal.** `config/origins.ts`, `authCookieSecure()` returns `false` on that
override regardless of `NODE_ENV`. `validateStartupConfig` checks
`AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `API_URL` and `FRONTEND_URL` — not this.
Session cookies then travel over plain HTTP.

**M4 — `AuthGuard` passes a session whose `user_profile` row is gone.**
`auth/auth.guard.ts:68` — `if (profile && profile.is_active === false)`.
`findUnique` returning `null` is not a thrown error, so it never reaches the
503 path the surrounding comment describes. Deliberate for a first sign-in
before onboarding, but profile removal does not end a live session.

**M5 — `PermissionGuard` falls back to the caller's active school.**
`permission/permission.guard.ts:71-96` trusts `request.params.schoolId`, else
resolves from `:courseId`, else uses `user_profile.school_id`. For a route that
names its resource only in the body or a bare `:id`, the permission is
evaluated in the caller's active school while the service acts on a resource in
another. Services re-check correctly today (`file-manager.service.ts:920` uses
`file.school_id`, not the active one), so this is defense-in-depth — but
correctness depends on every service remembering.

### Low / hardening

**L1 — `file_share` lookups not school-scoped.**
`file-manager/file-access.service.ts` — `bestShare()` (line 123) and
`downloadFlagsFor()` (line 209) query by `file_id` alone.
`sharedFileIdsFor()` does filter on `school_id`.

**L2 — Report-card signed links are bearer tokens in the URL path.**
`report-card/report-link.ts`. They land in Caddy access logs, CDN logs and
`Referer`. The 5-minute TTL bounds exposure; they are not single-use.

**L3 — `/health` is unauthenticated and names the failing dependency.**
`health/health.service.ts`. Caddy already uses `/` for liveness.

**L4 — Deterministic rotation plus a 24-hour lost-rotation grace.**
`account/session.service.ts:358-372`. A cookie stolen and replayed with the
same User-Agent, before the real client confirms the rotation, yields the live
session and raises no `token_reuse` alarm.

**L5 — `WEBHOOK_ALLOW_PRIVATE=true` disables the whole private-address block.**
Globally, for webhooks, LTI keysets and OneRoster — `169.254.169.254` included.
The AI module already does this per-provider in `ai/ai-fetch.ts`.

---

## Phase 0 — scaffolding

Prerequisite for Phase 2.

### 0.1 `@Public()` decorator

New file `backend/src/auth/public.decorator.ts`:

```ts
export const IS_PUBLIC_KEY = 'auth:public';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

### 0.2 Route-inventory regression test

New file `backend/src/auth/route-coverage.test.ts`. Boot the Nest application,
walk the router, and assert that every route is either covered by `AuthGuard`
or carries `@Public()`, and that the `@Public()` set equals a hardcoded
allowlist.

This is the durable fix for M2. The global guard alone can still be defeated by
someone adding `@Public()` without thought; a failing test on an allowlist
change cannot be.

---

## Phase 1 — configuration and deploy safety

One PR. No behaviour change for a correctly configured install.

### 1.1 Refuse `AUTH_COOKIE_SECURE=false` in production (M3)

`backend/src/config/startup.ts`, inside the `NODE_ENV === 'production'` block:

```ts
if (env.AUTH_COOKIE_SECURE === 'false' && env.LOCAL_PREVIEW !== 'true') {
  throw new Error(
    'AUTH_COOKIE_SECURE=false is not allowed in production: session cookies ' +
      'would be sent over plain HTTP. Remove it, or set LOCAL_PREVIEW=true ' +
      'for a local production build.',
  );
}
```

Add `AUTH_COOKIE_SECURE` to the `StartupEnvironment` type (`LOCAL_PREVIEW` is
already there). Tests in `config/startup.test.ts`: throws in production,
allowed under `LOCAL_PREVIEW=true`, allowed in development.

### 1.2 Keep `/health` detail on the internal network (L3)

`backend/src/createApp.ts`:

```ts
raw_instance.get('/health', async (req, res) => {
  const health = await app.get(HealthService).check();
  const code = health.status === 'ok' ? 200 : 503;
  // Only the Compose network sees which dependency is down.
  if (!isInternalPeer(req)) return res.status(code).send({ status: health.status });
  res.status(code).send(health);
});
```

`isInternalPeer` must read `req.socket.remoteAddress`, **not** `req.ip` —
`req.ip` honours `X-Forwarded-For` and is therefore client-influenced. Caddy
health-checks `/`, so nothing in `infrastructure/` changes.

Verify: `docker compose exec app1 wget -qO- localhost:3001/health` returns the
services block; an external `curl` returns `{"status":"ok"}` only.

### 1.3 Cookie scope: document and warn (M1)

The derivation is correct for the documented topology, so no forced code
change. Two deliverables:

- `docs/content/hosting-requirements.md` — a "Session cookie scope" section
  stating plainly that with the default, every subdomain of the registrable
  domain can read and overwrite `gb_session`; therefore no untrusted or
  third-party-hosted subdomain may exist under it. Recommend app and API on one
  host with `AUTH_COOKIE_DOMAIN=none`.
- `backend/src/config/origins.ts` — when `authCookieDomain()` returns a derived
  parent domain, emit a boot warning naming it, in the same shape as
  `insecureCookieWarning()`, wired in `createApp.ts` beside the existing one.

Follow-up, separate PR: when `authCookieDomain()` is `undefined` and
`authCookieSecure()` is true, rename the cookie to `__Host-gb_session`. That
touches `SESSION_COOKIE` in the backend and `frontend/proxy.ts`. Do not bundle
it here.

---

## Phase 2 — global `AuthGuard` (M2)

Largest blast radius. Ship alone, in one PR.

### 2.1 Register the guard

`backend/src/app.module.ts`, before the existing two:

```ts
{ provide: APP_GUARD, useClass: AuthGuard },
```

Order is correct as written: global guards run before controller and method
guards, so `PermissionGuard`, `AdminGuard`, `StudentGuard` and the rest still
see a populated `request.user`. Keep `ThrottlerGuard` first so rate limiting
runs ahead of a database lookup.

Dependency injection is safe: `AuthGuard` needs `SessionService`,
`PrismaService` and the optional `MfaService`, and `PrismaModule`,
`AccountModule`, `MfaModule` and `CacheModule` are all `@Global()`.

### 2.2 Bail out on `@Public()`

First lines of `AuthGuard.canActivate`:

```ts
if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY,
    [context.getHandler(), context.getClass()])) return true;
```

Inject `Reflector`.

### 2.3 The exact public surface

Verified by walking every controller. Mark these, and only these:

| File | Routes |
| --- | --- |
| `app.controller.ts` | `GET /api` |
| `app-version/app-version.controller.ts` | `GET app/version` |
| `images/images.controller.ts` | both GETs (mark at class level) |
| `attendance/scan-claim.controller.ts` | `POST attendance/scan-claim` |
| `report-card/report-link.controller.ts` | `GET report-cards/files/:token` |
| `auth/auth.controller.ts` | `POST otp/send`, `POST dev/code`, `POST otp/verify` |
| `mfa/mfa.controller.ts` | `POST auth/mfa/verify` |
| `sso/sso.controller.ts` | `GET providers`, `GET discover`, `GET saml/metadata`, `POST saml/acs`, `GET :provider/start`, `GET callback`, `POST handoff` |
| `lti/lti.controllers.ts` | `GET lti/jwks`, `GET lti/auth`, `POST lti/auth`, `POST lti/token`, and the whole `lti/ags/...` controller (it authenticates with its own `LtiAgsGuard` bearer check) |

Everything else must go through `AuthGuard`.

### 2.4 Leave the existing `@UseGuards(AuthGuard, ...)` lists alone

They become redundant but stay harmless. Removing `AuthGuard` from 75
decorators would bury a mistake in an enormous diff. Record it as later
cleanup, after the route-coverage test has been green for a release.

### 2.5 Verification

The Phase 0 test, plus a manual pass over each flow that was previously
unauthenticated: email sign-in, SSO round trip, an LTI launch, a QR scan claim,
a report link, and mobile bearer authentication. Then `bun run smoke`.

---

## Phase 3 — authorization correctness

### 3.1 A removed profile ends the session (M4)

`backend/src/auth/auth.guard.ts:63-73`. Replace the "deny only on explicit
false" check with a positive decision. Sketch:

```ts
const profile = await this.prisma.user_profile.findUnique({
  where: { id: user.id },
  select: { is_active: true },
});
// No profile is legitimate only before onboarding; a profile that was
// removed must not keep a live session.
if (!profile) {
  if (await this.hasCompletedOnboarding(user.id)) {
    await this.sessions.revoke(request, reply, 'deactivated');
    throw new UnauthorizedException('Account is no longer available');
  }
} else if (profile.is_active === false) {
  // ... existing branch
}
```

Confirm the column that marks onboarding before writing
`hasCompletedOnboarding` — do not assume `app_user.onboarded_at` exists. If
there is no such marker, treat a missing profile as terminal and prove first
sign-in still works with a test. Cover both cases in `auth.guard.test.ts`.

### 3.2 Explicit school context for `PermissionGuard` (M5)

`backend/src/permission/permission.guard.ts:71-96`. The hazard is the silent
fallback, not the fallback itself.

1. Extend `@RequirePermission(resource, action)` with an optional third
   argument: `{ scope: 'param' | 'course' | 'active' }`.
2. The guard resolves strictly by the declared scope when one is given.
3. With no scope declared, keep today's behaviour but log at `warn` with the
   route path, so the remaining implicit routes surface in staging logs.
4. Work through that log and annotate each route; routes acting on a
   body-supplied id get an explicit resolver.

Ship the mechanism and the logging first. The annotation pass is a follow-up
driven by the log output — do not attempt all 24 `PermissionGuard` controllers
in one PR.

### 3.3 School-scope the `file_share` lookups (L1)

`backend/src/file-manager/file-access.service.ts` — add `school_id: schoolId`
to the `findMany` in `bestShare()` (line 123) and `downloadFlagsFor()` (line
209), matching `sharedFileIdsFor()`. `accessFor` already has the school id;
`downloadFlagsFor` needs a new parameter, so check its callers. Add a test with
a share row whose `school_id` differs from the file's.

Ship 3.1 and 3.3 together; 3.2 separately.

---

## Phase 4 — token hygiene

### 4.1 Single-use report links (L2)

`backend/src/report-card/report-link.ts` and `student-reports.service.ts:166`.
Add a `j` (jti, 16 random bytes, base64url) claim in `signReportLink`. In
`openSignedLink`, consume it: insert into a small `report_link_use` table
(`jti` primary key, `used_at`, `expires_at`) and reject on conflict. Purge via
the existing retention sweep. The 5-minute TTL stays as a second bound.

Lower-effort alternative if the migration is unwelcome: consume through
`CacheService` with the same TTL. Weaker across a Redis flush, but no schema
change.

### 4.2 Narrow the lost-rotation grace (L4)

`backend/src/account/session.service.ts:358-372`.
`LOST_ROTATION_GRACE_MS` is 24 hours on a User-Agent match alone.

- Drop the default to 1 hour, configurable in `session.config.ts` beside
  `rotationGraceMs()`.
- Then either require `row.ip === req.ip` in the `lostRotation` condition, or —
  if mobile networks make that too flaky — emit a session alert on every
  lost-rotation recovery.

Pick one. The alert is the safer default for a mobile-heavy app. Existing
coverage is in `session-policy.test.ts`.

---

## Phase 5 — narrow the SSRF switch (L5)

Follow the pattern `ai/ai-fetch.ts` already uses.

- Add a per-destination `allow_private_network` boolean to the webhook, LTI
  tool and OneRoster configuration rows.
- Pass it explicitly as `allowPrivate` at every `safeWebhookFetch` and
  `resolveWebhookDestination` call site, so `webhook-destination.ts:81` never
  consults the environment.
- Keep `WEBHOOK_ALLOW_PRIVATE` for one release as the default for newly created
  rows, log a deprecation at boot when it is set, then remove it.
- Regardless of any flag, always block `169.254.0.0/16`: cloud instance
  metadata is never a legitimate destination.

Needs a migration and a UI field. Schedule last.

---

## Sequencing

| Order | Work | Notes |
| --- | --- | --- |
| 1 | Phase 0 + Phase 1 | One small PR, no behaviour change |
| 2 | Phase 2 | Alone; verify every previously public flow |
| 3 | Phase 3.1 + 3.3 | Together |
| 4 | Phase 3.2 | Mechanism and logging first, annotation follows |
| 5 | Phase 4 | 4.1 needs a migration |
| 6 | Phase 5 | Needs a migration and UI |
