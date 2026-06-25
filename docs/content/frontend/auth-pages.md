---
sidebar_label: Auth Pages
---

# Authentication Pages

The authentication flow consists of three pages: login, OTP verification, and onboarding.

## Login Page

**Route**: `/login`  
**File**: `app/login/page.tsx`

The login page presents a centered card with an email input field. When the user submits their email:

1. Calls `POST /api/auth/otp/send` with the email
2. On success, navigates to `/login/verify?email=<email>`
3. On failure, shows a toast error

**UI Elements:**
- `AuthPageShell` wrapper (centered card layout with theme toggle)
- Email input with validation
- Submit button with loading state
- Uses Preact signals for state

## OTP Verification Page

**Route**: `/login/verify`  
**File**: `app/login/verify/page.tsx`

The verification page shows an 8-digit OTP input. The email is read from the URL query parameter.

**Flow:**
1. If no `email` query param → redirect back to `/login`
2. User enters the 8-digit code from their email
3. Calls `POST /api/auth/otp/verify` with email + token
4. On success:
   - The backend writes the Supabase session cookies (`sb-*-auth-token*`) on the response - the frontend doesn't need to store anything
   - `await refresh()` (from `useAuth()`) re-fetches `/auth/me` so the persistent `AuthProvider` profile is populated **before** navigating - otherwise the dashboard layout reads the stale logged-out profile and bounces straight back to `/login`
   - If `user.is_onboarded` is false → redirect to `/onboard`
   - Otherwise → redirect to `/dashboard`
5. On failure, shows a toast error

**UI Elements:**
- `InputOTP` component with 8 slots
- Back link to `/login`
- Wrapped in `Suspense` (required for `useSearchParams` in Next.js)

## Onboarding Page

**Route**: `/onboard`  
**File**: `app/onboard/page.tsx`

Shown to first-time users who have authenticated but haven't completed their profile.

**Form Fields:**
- First name (required)
- Last name (required)
- School selection dropdown
  - Fetches schools from `GET /api/schools`
  - Includes a "Create School" option that opens a dialog
- Create School dialog (if school doesn't exist):
  - Name and school type (primary/secondary)

**Flow:**
1. User fills in name and selects/creates a school
2. Calls `PATCH /api/auth/onboard` with `firstName`, `lastName`, `schoolId`
3. On success → redirect to `/dashboard`

## Authentication State

The frontend has **no token storage** - there is no `lib/auth.ts`, no `localStorage`, no in-memory access token. All session state lives in HTTP-only cookies set by the backend, and the browser sends them automatically on every request thanks to `credentials: "include"` in `lib/api.ts`.

| Cookie | Set by | Purpose |
|--------|--------|---------|
| `sb-<project>-auth-token` (chunked: `.0`, `.1`, ...) | Backend `setAll` handler in `SupabaseService` | Encoded session payload (access token + refresh token) |

The access token expires after 1 hour, but the backend's `AuthGuard` calls `auth.getUser()` on every authenticated request, which silently refreshes the token and writes new cookies on the response. The frontend never sees a 401 unless the refresh token itself is invalid (30+ days inactive, revoked, or cookies manually cleared).

When a 401 does occur, `lib/api.ts` bounces to `/login` automatically.

`AuthProvider` (mounted in the root layout) fetches `/auth/me` **once** and shares the resulting `profile` signal app-wide, so it survives soft navigations. Because it doesn't re-fetch on its own, any flow that changes the session - logging in via the OTP page - must call `refresh()` afterwards so the profile reflects the new cookie before the next guarded route reads it.

## Route Protection

The `proxy.ts` middleware runs on every navigation to `/dashboard/*`, `/onboard/*`, and `/login/*`. It checks for the presence of any cookie matching `sb-*-auth-token*`:

- If navigating to a protected route without a session cookie → redirect to `/login`
- If navigating to `/login` with a session cookie → redirect to `/dashboard`

The check is only a presence test. If the cookies are corrupted or the session is invalid, the middleware will let the user through and the first API call from `useProfile` will return 401 - at which point `lib/api.ts` redirects to `/login`. There is a brief flash of the dashboard frame in this edge case, but no broken state.
