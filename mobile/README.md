# GradeBook Mobile

A React Native (Expo SDK 57) mobile client for GradeBook, mirroring the web
frontend's design system and core flows.

## Scope (MVP)

- **OTP email auth** — send code → verify 8-digit code → cookie session
  (`/auth/otp/send`, `/auth/otp/verify`), matching the web flow exactly.
- **Dashboard** — admin overview (stats + staff/student donut charts + current
  academic year) and teacher overview (class list with student counts). Users
  who are both get a segmented toggle.
- **Classes** — assigned classes split into *My Classes* / *Subject Classes*.
- **Students** — searchable (debounced) school roster.
- **Settings** — profile, light/dark/system theme, logout.
- **Assignment submissions** — attach files, or multiple files when the teacher
  enables that option (up to 20, 100 MB each), and hand in text and/or files.
  DOCX files can be previewed by course staff, while legacy DOC files are
  included in their submission ZIP.

## Architecture

| Web (`frontend/`)          | Mobile (`mobile/`)                             |
| ---------------------------- | ------------------------------------------------ |
| Next.js app router           | `expo-router` (file-based, `app/`)           |
| shadcn + Tailwind (oklch)    | `src/theme` tokens + `src/components/ui`     |
| `lib/api.ts` (cookie auth) | `src/lib/api.ts` (native cookie jar)           |
| `AuthProvider` (signals)   | `src/providers/AuthProvider` (context)         |
| `sonner` toasts            | `src/providers/ToastProvider`                  |
| `recharts`                 | `src/components/charts` (`react-native-svg`) |
| `lib/errors.ts`            | `src/lib/errors.ts` (same rules)               |

Every toast, alert and inline error goes through `userMessage(err, fallback)`
in `src/lib/errors.ts`: a 4xx shows the API's message when it is plain text
(stack frames, Prisma/SQL text, file paths, `TypeError`s, JSON parse errors and
HTML pages are rejected, and long text is cut to 200 characters); a 5xx shows
"Something went wrong. Please try again." plus the API's `errorId` as a
reference; a request with no response shows "Can't reach the server…";
anything else shows the fallback. Errors thrown with messages written for the
user (`FriendlyError`, e.g. `UploadError` and the location errors) are shown.
A render error shows `src/components/layout/ErrorScreen.tsx` (exported as the
root `ErrorBoundary` from `app/_layout.tsx`) with "Try again".

The search and filter lists (courses, students, files, folder contents, chat
history, notices) use the HTTP `QUERY` method: `apiQuery(path, filters)` in
`src/lib/api.ts` sends the filters as a JSON body. App builds from before this
send `GET` there and get 404s, so `MOBILE_MIN_VERSION` should be raised to the
first build with `QUERY` once it is in both stores
(`docs/content/backend/http-query.md`).

Auth is cookie-based: the API sets one opaque httpOnly session cookie,
`gb_session`, on `/auth/otp/verify` and on `/auth/sso/handoff` (SSO sign-ins
come back as a one-time code that the app trades for the cookie). React
Native's fetch keeps and resends it through the native cookie store
(`credentials: "include"`), so the app never handles a token. The cookie
survives app restarts because the API gives it an expiry (30 days, sliding);
a cookie without one would be dropped when the app is killed.

## App updates

Every request carries `X-GradeBook-App-Version: <ios|android>/<version>`
(`expo-application`'s `nativeApplicationVersion`, sent from
`src/lib/session-token.ts`). `src/features/app-update/UpdateGate.tsx`, mounted
in `app/_layout.tsx`, calls `GET /api/app/version` on launch and on returning
to the foreground (at most every 6 hours after a successful check):

- below the platform `minimum` - a blocking full-screen "Update required"
  modal whose only actions are "Update" (opens the store URL) and "Check
  again". A `426 update_required` from any API call opens the same screen
  (`src/lib/update-required.ts`, flipped from `errorFrom` in `src/lib/api.ts`);
- below `latest` - an "Update available" alert; "Later" is remembered per
  release in SecureStore (`gb_update_dismissed`);
- a failed check never blocks anything.

Both settings screens have a "Check for updates" card
(`src/features/app-update/CheckForUpdates.tsx`). Versions compare with
`src/lib/version.ts` (numeric MAJOR.MINOR.PATCH, same rules as the API). The
versions and store URLs are configured on the backend (`MOBILE_MIN_VERSION`,
`MOBILE_LATEST_VERSION`, `MOBILE_*_STORE_URL`; see
`backend/src/app-version/README.md`). Raise the minimum only once the new
build is live in both stores.

SSO sign-ins use a PKCE-style verifier (`src/lib/sso.ts`): 32 random bytes and
a SHA-256 challenge from `expo-crypto`. Native module changes need a fresh
`pod install` (`cd ios && pod install`) and a new dev-client build.

## Running

```bash
# from repo root
bun install
bun dev                     # starts workspace dev tasks and opens iOS Simulator
bun preview                 # starts production-preview tasks and opens iOS Simulator

# open/build the iOS app in the Simulator (from repo root)
bun run ios

# platform shortcuts (from mobile/)
bun run ios | android | web
```

### Backend URL

In a release app, enter the school's public GradeBook URL on first launch
(for example `https://school.example.com`; the API is expected at `/api`).
For development, copy `.env.example` to `.env` and optionally set
`EXPO_PUBLIC_API_URL` (no `/api` suffix):

- iOS simulator: `http://localhost:3001`
- Android emulator: `http://10.0.2.2:3001`
- Physical device: `http://<your-LAN-ip>:3001`

## Checks

```bash
bun run typecheck   # tsc --noEmit
bun run build       # expo export (web bundle)
```

## Not yet ported

Staff, subjects, files, chat/messages, announcements, roles, grade scales,
academic-calendar editing, attendance, grading, reports, and the school
onboarding flow. Authenticated users without a school are routed to a
"finish setup on web" screen.
