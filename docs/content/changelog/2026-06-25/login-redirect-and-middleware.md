---
sidebar_label: 2026-06-25 · Login redirect fix & middleware cleanup
sidebar_position: 1
---

# 2026-06-25 - Login redirect fix and middleware cleanup

A frontend auth-flow bugfix plus a no-behavior-change cleanup of the auth middleware. No migrations, no API shape changes.

## Intermittent bounce back to /login after a successful login

After entering a valid OTP, users were sometimes returned to `/login` instead of landing on the dashboard. The redirect was not coming from the middleware - the freshly-set cookie passes `proxy.ts` fine. It came from stale client state.

`AuthProvider` ([providers/AuthProvider.tsx](../../../../frontend/providers/AuthProvider.tsx)) lives in the root layout, so it fetches `/auth/me` **once** on app load and persists across navigations. On the login page that fetch runs while logged out → 401 → `profile = null`, `loading = false`. After a successful verify, `router.push("/dashboard")` is a **soft** navigation, so `AuthProvider` never remounts and `profile` stays the stale `null`. The dashboard layout ([app/dashboard/layout.tsx](../../../../frontend/app/dashboard/layout.tsx)) then sees `!profile && !loading` and calls `router.replace("/login")`.

It was intermittent because it depended on the race: if the initial `/auth/me` was still in flight at dashboard mount (or a leftover session cookie had populated `profile`), it slipped through; otherwise it bounced.

The fix: after a successful verify, the OTP page now `await`s `refresh()` from `useAuth()` before navigating ([app/login/verify/page.tsx](../../../../frontend/app/login/verify/page.tsx)). The verify response has already set the session cookie, so this re-fetch of `/auth/me` succeeds and populates `profile` - the dashboard guard then passes deterministically.

## Middleware path-matching cleanup

`proxy.ts` ([frontend/proxy.ts](../../../../frontend/proxy.ts)) eagerly computed both `isPublic(pathname)` and `isGuestOnly(pathname)` on every request, even though each branch needs at most one of them (and `GUEST_ONLY ⊂ PUBLIC_PATHS`). The two checks are now deferred so each branch evaluates only the one it needs, and the repeated `applySetCookies` + return tails were collapsed into a single `target` assignment.

Pure refactor - the redirect behavior is unchanged. The biggest perf lever (the `config.matcher` skipping API/static/image/prefetch/RSC requests) was already in place.

## Behavior note

There is one extra `/auth/me` round-trip on the verify→dashboard transition now (the `refresh()` call), adding ~one request worth of latency to the Verify button. This is the cost of eliminating the race; the profile is guaranteed ready before the dashboard guard runs.
