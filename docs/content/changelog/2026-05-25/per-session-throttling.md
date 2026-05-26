---
sidebar_label: 2026-05-25 · Per-session throttling
sidebar_position: 4
---

# 2026-05-25 - Per-session throttling

Follow-up to [Auth + dev ergonomics](./auth-and-dev-ergonomics.md), which bumped dev throttle limits but left the underlying issue open: in production, the Next.js middleware re-validating sessions against `/auth/me` was exhausting the IP-based rate limit because every user behind a given Next.js instance shared a single bucket.

## Problem

The `default` throttler in `backend/src/app.module.ts` keyed off the request IP. That's fine for direct browser → backend traffic, but [frontend/proxy.ts](../../../../frontend/proxy.ts) runs in the Next.js Node process and calls `${BACKEND}/api/auth/me` whenever the session cookie is stale or malformed:

```ts
async function validateOnBackend(request: NextRequest): Promise<Response> {
  return fetch(`${BACKEND}/api/auth/me`, {
    headers: {
      cookie: request.headers.get("cookie") || "",
      "X-API-Version": "1",
    },
  });
}
```

From the backend's point of view every one of those requests has the same source IP (the Next.js server's), so the entire fleet of users behind a given Next.js instance shared one `default:<ip>` bucket - 300 req/60s at the time, easily blown past by a handful of concurrent users navigating around. Some users started seeing 429s on first page load.

## Fix

The `default` throttler now derives its tracker from the session, not the IP. Resolution order, first hit wins:

1. **`Authorization: Bearer <token>`** - native API clients (Swagger, mobile, direct curl).
2. **Supabase `sb-*-auth-token` cookie value(s)** - cookie-based clients, including the Next.js middleware re-validating against `/auth/me`. The cookie is chunked across `.0`, `.1`, ... when the payload is large; we concatenate name-sorted chunks so the key is stable across requests.
3. **Caller IP** - only used for truly unauthenticated traffic.

Both authenticated paths feed into a truncated SHA-256 (22 base64url chars, ~132 bits) so the throttler storage never holds raw tokens. Keys are prefixed `u:` for sessions and `ip:` for the IP fallback to keep the two namespaces unambiguous.

After this change, each authenticated user gets their own default-bucket budget regardless of which Next.js instance their requests transit through.

## Production limit raised to 10,000 / 60s

The same deploy raised the `default` bucket from 300 to 10,000 req/60s in production (dev unchanged at 1,000). Even with per-session tracking, 300 was still being tripped on first reloads, almost certainly because something on the frontend is firing requests in a tight loop (an effect / query refetch worth chasing separately). 10,000/min/user is generous enough that legitimate UI behaviour can't realistically hit it; the throttler is now mostly a circuit-breaker against pathological abuse rather than a tight per-user cap. Worth revisiting once the underlying request-loop bug is fixed.

## What did not change

- Dev `default` limit (1000 req/min) and the entire `auth-strict` bucket (5/hour prod, 100/hour dev) - unchanged from [Auth + dev ergonomics](./auth-and-dev-ergonomics.md#dev-only-throttle-relief).
- `auth-strict` tracker - still keys off `body.email` (then IP) precisely because there is no session yet on `/auth/otp/send` and `/auth/otp/verify`.
- `getClientIp` semantics - same `X-Forwarded-For`-aware extraction, still applied to the `auth-strict` bucket and the unauthenticated fallback. The [nginx hardening](../2026-05-24/high-fixes.md#nginx-hardening) that made `X-Real-IP` the real TCP peer is still the source of truth for that IP.
- No client changes. The Next.js middleware was already forwarding the user's session cookie verbatim; that cookie is now what the throttler keys off.

## Notes on cookie rotation

Supabase rotates the access token on refresh, which changes the cookie value and thus changes the throttler key. In practice that means a user crossing a token refresh gets a fresh bucket - which is fine (refresh is rare relative to the 60s window) and strictly better than getting wrongly 429'd because someone else burned their bucket.

## Tests

No new unit tests - the throttler is wired at module construction and not unit-testable in isolation. Existing suite (103 tests) still passes; behaviour verified by inspection of `getSessionTracker` plus the existing route tests.
