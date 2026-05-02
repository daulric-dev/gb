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
   - Stores the access token in memory via `setAccessToken()`
   - The refresh token is set as an httpOnly cookie by the backend
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
  - Name, code, school type (primary/secondary), parish dropdown (Grenada parishes), address, email, phone

**Flow:**
1. User fills in name and selects/creates a school
2. Calls `PATCH /api/auth/onboard` with `firstName`, `lastName`, `schoolId`
3. On success → redirect to `/dashboard`

## Authentication State

Tokens are managed in `lib/auth.ts`:

| Storage | Key | Purpose |
|---------|-----|---------|
| In-memory + `localStorage` | `gb_access_token` | JWT for API requests; shared across tabs via localStorage |
| httpOnly cookie | `gb_refresh_token` | Token for refreshing expired JWTs (set by backend) |

On page load, `bootstrapSession()` first checks `localStorage` for an existing access token (set by another tab). If found, it uses it directly. Otherwise it calls `POST /api/auth/refresh` using the cookie to obtain a fresh access token. This avoids consuming Supabase's one-time refresh token when multiple tabs are open.

The middleware (`proxy.ts`) checks for the `gb_refresh_token` cookie to gate access to protected routes.

## Route Protection

The `proxy.ts` middleware runs on every navigation to `/dashboard/*`, `/onboard/*`, and `/login/*`:

- If navigating to a protected route without the `gb_refresh_token` cookie → redirect to `/login`
- If navigating to `/login` with the cookie present → redirect to `/dashboard`
