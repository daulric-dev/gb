---
sidebar_label: 2026-09-20 · Mobile student app
sidebar_position: 7
---

# 2026-09-20 - Mobile: student parity, connectivity, claymorphism

## Feature parity for students

The mobile portal had Overview, Grades, Attendance, Reports and Settings. The web portal had those **plus Work** - the whole quizzes-and-assignments feature - and a report detail view. Both are now on mobile.

- **Work tab** - quizzes and assignments for the student's classes, outstanding first, marks shown where they exist.
- **Work detail** - all three question types including short answer, attempts with a *Try again* button and the form clearing between attempts, assignment text submission, resumable file attachment, marks, feedback, and the closed-before-you-submitted case.
- **Report detail** - average, position, attendance, conduct, per-subject results with letter grades and teacher remarks. Report rows in the list now open it.

Verified against a live database that every shape the screens read matches what the API returns, including that **no answer key is present in the student payload**.

## The app could not reach the API

Three separate causes, depending on how it was run.

**The base URL was `localhost:3001`.** There was no `.env`, so it fell back to localhost - which works in the iOS simulator and Expo web, but on a device or Android emulator is *the device itself*. Hardcoding a LAN address just moved the problem: **the machine's address changed mid-session** (`192.168.0.11` → `.12`) and everything broke again.

The app now **derives the API host from the Expo dev server it loaded from** - whatever address reached Metro can reach the API beside it - so it follows the machine across DHCP leases. `EXPO_PUBLIC_API_URL` still overrides for a deployed backend.

**CORS allowed only `http://localhost:3000`.** Expo web serves from `:8081`, so every request from it was blocked and cookies never got set. `FRONTEND_URL` now takes a comma-separated list, and in development LAN origins are accepted by shape (`localhost`, `127.0.0.1`, `10.x`, `192.168.x`, `172.16–31.x`) rather than by a list that needs maintaining. Production is unaffected - the relaxation is gated on `NODE_ENV`.

**The TUS upload endpoint pointed at `127.0.0.1:54321`**, unreachable from a phone. It is now derived from the request's `Host` header: if the client reached the backend at `192.168.0.12:3001`, Storage is at `192.168.0.12:54321`. A hosted Supabase URL is never rewritten.

### The error message was lying

Both clients did `err instanceof ApiError ? err.message : "Failed to send OTP"`. A network failure rejects with a bare `TypeError`, not an `ApiError` - so **any unreachable-server situation printed "Failed to send OTP"**, pointing at Supabase and email delivery when the request had not left the device.

A request that gets no response now throws `ApiError(0, "Can't reach the server. Check your connection.")` in both clients, so every screen reports the real problem.

### A bug this introduced, and caught

Making `FRONTEND_URL` a list broke four consumers that treated it as a single URL - most seriously the **auth cookie domain**, which does `new URL(FRONTEND_URL)` and would have thrown **in production**, plus two hand-written CORS headers (chat SSE and the class-zip download) that would have emitted an invalid header value. All five now go through [origins.ts](../../../../backend/src/config/origins.ts).

## Claymorphism

The whole app moved to a claymorphic treatment, done in the **theme and shared components** - no screen files were touched, so new screens inherit it.

[clay.ts](../../../../mobile/src/theme/clay.ts) defines four shadow recipes, each combining an outer cast with inset highlight and shade: `surface` (cards, sheets, dialogs, tab bar), `raised` (badges, tab chips, avatars, selected segment), `pressed` (buttons deflate and shift 1px), and `inset` (text inputs, selects, OTP slots, segmented-control track). React Native has supported inset shadows via `boxShadow` since 0.76.

The palette stayed the **web app's neutral one** - restored from git rather than retyped, so the two apps cannot drift - with shadows in neutral grey. Filled buttons carry **no outer shadow at all**: a cast in the button's own colour reads as a glow, which was particularly bad in dark mode where a near-white button haloed onto a near-black card.

In light mode a card is the same white as the page, so the outer shadow does all the separating and is a shade stronger than it would need to be on a tinted background.

## Pull to refresh and safe areas

**Refresh** now covers every screen with something to reload - seven more than before. Two needed plumbing: the attendance loader did not return its promise so the spinner had nothing to track, and `ClassContext` fetched once with no way to refetch (it now exposes `reload`). The only screen without it is **More**, a static nav menu with no API calls.

The control itself gained `progressViewOffset` equal to the top inset - without it the spinner appears **behind the notch** - theming, and `alwaysBounceVertical` so a short page can still be pulled.

**Safe areas** were handled top and bottom but not the sides. Held sideways the notch is on a side and the gutter was a flat 16px; `Screen` and `AuthShell` now add `insets.left`/`insets.right`. Non-scrolling screens ignored the bottom inset, so the home indicator sat on top of the last row, and that branch had no `flex: 1`.

## Verification limits

Everything here was verified by typecheck, by exercising the API contracts the screens depend on, and by rendering through **Expo web**. There is no simulator or device in this environment, so:

- **The claymorphic shadows are representative, not identical.** RN Web translates `boxShadow` to CSS; native compositing may read heavier or lighter. The numbers are all in one file if they need adjusting.
- **Notch behaviour is unverified.** Expo web reports all insets as zero. What is confirmed is that the values are read and applied on all four edges.
- **The mobile upload path is untested on a device.** The Blob-from-URI step is the only place mobile genuinely differs from web.
