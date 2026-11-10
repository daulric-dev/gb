# GradeBook Mobile

A React Native (Expo SDK 57) mobile client for GradeBook, mirroring the web
frontend's design system and core flows.

## Scope (MVP)

- **OTP email auth** — send code → verify 8-digit code → bearer session token
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
| `lib/api.ts` (browser cookie) | `src/lib/api.ts` (opaque bearer session)      |
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

The API issues an opaque session token (not a JWT). The mobile app receives it
in the `X-Session-Token` response header and stores it in the device keychain or
keystore; authenticated requests send it as a bearer token. This is separate
from the web app, which uses the `gb_session` HTTP-only cookie. Mobile sessions
can be revoked server-side from Signed-in devices, including signing out all
other devices.

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

## Offline mode (students)

No new native package: storage is `expo-file-system` (already a dependency)
and connectivity is judged from real requests, so no dev-client rebuild is
needed.

- **Connectivity** (`src/lib/connectivity.ts`): `api()` marks the app offline
  when `fetch` gets no answer at all and online on any response.
  `src/providers/OfflineProvider.tsx` probes `GET /app/version` while offline
  (5s doubling to 60s, and on returning to the foreground); back online it
  re-reads the profile, runs the draft queue and refreshes saved copies.
- **Saved copies** (`src/lib/offline-cache.ts`, pure; files in
  `<caches>/offline-reads/`): one JSON file per GET plus an index, an 8 MB cap
  with least-recently-used eviction. Every entry belongs to a scope (API
  origin + student id), checked against the entry itself on read, so another
  account never sees it. Screens read through `useOfflineReads().get(path)`
  (`src/features/offline/OfflineReads.tsx` → `cachedGet` in
  `src/lib/offline-reads.ts`): online it saves the answer, with no answer it
  serves the copy, and a 403/404 drops it. `Screen` shows "Offline - showing
  saved copy from ..." and calls `onRefresh` once back online. Covered: the
  portal home and work list, a course's card, home, modules and work
  sections, course pages and the work screen. `prefetchForOffline()`
  (`src/lib/offline-sync.ts`) saves active courses, their modules and pages
  and outstanding work at most every 6 hours. A Lockdown quiz is saved
  without its questions or attempt. Staff get no scope: their screens never
  touch offline data.
- **Drafts** (`src/lib/sync-queue.ts`, pure; `<documents>/offline-data/drafts.json`):
  - *Quiz answers* of a running attempt, saved offline (or while an earlier
    draft is still waiting), are queued and sent in order with the existing
    `POST /portal/me/activities/:id/quiz/answers` and an `Idempotency-Key`
    header (one key per snapshot, reused on every retry; the save replaces
    the attempt's answers as a whole, so a repeat is harmless and older APIs
    ignore the header). Retries back off 2s doubling to 5 minutes; an item
    that must wait holds back the ones behind it.
  - *Assignment text* is kept on the device as it is typed. The API has no
    draft endpoint for assignments, only the hand-in, so it is never sent by
    the queue; it waits for an online **Hand in**.
  - *Never sent after the deadline:* the attempt's `quiz_expires_at`, else
    the student's close date (extension, else late-until, else due date). The
    draft "needs attention" and the work screen says "This was due while you
    were offline; your draft is saved on this device" with view and
    share/copy (`OfflineDraftNotice`). An attempt that ended or was replaced
    (auto-submitted, submitted elsewhere) and a `409` from the save are
    treated the same way.
  - *Conflicts:* the portal does not send the submission's `updated_at`, so
    a draft records the version of the server copy it started from (a
    normalised fingerprint of the attempt and its answers, or of the
    assignment's status and text; the screen moves it forward with its own
    saves). If the server copy differs before sending, nothing is sent, both
    copies are kept and the student picks one.
  - *Not queued:* final submissions (submit quiz, hand in) use up an attempt
    and aren't idempotent, so they need a connection; file uploads go
    straight to storage with a short-lived ticket; Lockdown quizzes can't
    report presence offline, so their answers are not drafted offline and
    answering pauses until the connection is back.
  - States: "Saved offline" / "Syncing" / "Synced" / "Needs attention" on the
    work screen and as a badge on work rows (`DraftBadge`).
- **Opening offline:** the last student profile for this server is kept in
  `<documents>/offline-data/profile.json`; when `/auth/me` gets no answer the
  app opens with it instead of waiting.
- **Clearing:** logout and server switch delete everything
  (`clearOfflineData`, next to `clearOpenedFiles`); a 401 drops saved copies
  and the profile but keeps that student's drafts (scoped) for their next
  sign-in. Student **Settings > Offline data** shows storage used and unsent
  drafts, saves courses now, and clears saved copies; logout warns first when
  unsent drafts would be deleted.
- Tests: `bun test src/lib` (`offline-cache.test.ts`, `sync-queue.test.ts`,
  `offline-draft-text.test.ts`).

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
(for example `https://school.example.com`). If that is the frontend and the API
is on a different host, the frontend should publish
`/.well-known/gradebook.json` with `{"apiUrl":"https://api.school.example.com"}`.
The app also accepts the backend URL directly.
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
