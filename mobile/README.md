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

## Architecture

| Web (`frontend/`)          | Mobile (`mobile/`)                          |
| -------------------------- | ------------------------------------------- |
| Next.js app router         | `expo-router` (file-based, `app/`)          |
| shadcn + Tailwind (oklch)  | `src/theme` tokens + `src/components/ui`    |
| `lib/api.ts` (cookie auth) | `src/lib/api.ts` (native cookie jar)        |
| `AuthProvider` (signals)   | `src/providers/AuthProvider` (context)      |
| `sonner` toasts            | `src/providers/ToastProvider`               |
| `recharts`                 | `src/components/charts` (`react-native-svg`)|

Auth is cookie-based: the backend sets Supabase SSR httpOnly cookies on verify,
and React Native's fetch persists/resends them via the native cookie store — so
no manual token handling is needed (the web `credentials: "include"` default).

## Running

```bash
# from repo root
bun install
bun run dev:mobile          # or: cd mobile && bun run start

# platform shortcuts (from mobile/)
bun run ios | android | web
```

### Backend URL

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` (no `/api` suffix):

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
