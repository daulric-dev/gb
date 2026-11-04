---
sidebar_label: Mobile in production
sidebar_position: 7
---

# Shipping the mobile app

The app is Expo (SDK 57 / React Native 0.86) and talks to the same backend as the web app. Nothing about the API differs between the two clients; what differs is how the app is told where the backend is, and that it must be HTTPS.

## Connect to a self-hosted instance

On first launch, the app asks for the school's public GradeBook URL (for example
`https://school.example.com`). The backend must be reachable at
`https://school.example.com/api` and `/health` must return a healthy response.
The app validates the URL and saves the selected server on the device. Sign-in,
SSO, and all later API requests use that instance. A signed-out user can choose
**Change school server** on the login screen.

Only enter a server address provided by a trusted school. Sign-in details are
sent directly to the selected instance. The choice is stored securely on iOS
and Android; development builds may still use `EXPO_PUBLIC_API_URL` or discover
the API from the Expo dev server.

## HTTPS is not optional

iOS App Transport Security is configured with `NSAllowsArbitraryLoads: false` and `NSAllowsLocalNetworking: true` - cleartext works on the local network for development and nowhere else. A production `http://` URL will fail on iOS with no useful error.

## Auth cookies

Auth is one httpOnly cookie, `gb_session` (opaque, 30-day sliding expiry), which React Native persists in the platform's native cookie store - no token handling in app code. Two backend settings decide whether that works:

- **`NODE_ENV=production`** makes the cookie `Secure`, so the API must be HTTPS (it already must be, for ATS).
- **`AUTH_COOKIE_DOMAIN`** sets the cookie's `Domain`. If the derived default does not cover the API's own host, the client **rejects the cookie and every request after login is unauthenticated** - with no error to point at it. See [Environment variables](./environment-variables.md).

A native client has no frontend domain of its own; it only ever talks to the API host. The `Domain` attribute exists for the **web** app, whose proxy checks for the cookie on its own domain. SSO on mobile ends in `POST /auth/sso/handoff`, which trades a one-time code for the same cookie.

## Direct uploads

Files upload straight to object storage (S3-compatible) with presigned URLs, so the app needs to reach storage as well as the API:

- The backend signs upload URLs for `S3_PUBLIC_ENDPOINT` (or `S3_ENDPOINT` when unset). That host must be reachable from the phone - in production an HTTPS endpoint such as `https://<account-id>.r2.cloudflarestorage.com`; in development a LAN address, not `127.0.0.1`.
- The app sends exactly the headers in the upload ticket and no cookies, then calls the ticket's `complete` route so the backend can check and release the file. A `503` from `complete` (the server is busy checking other uploads) is retried a few times with backoff; the file stays pending meanwhile.
- Assignment hand-ins, **Files** uploads and the profile picture all use this path (`src/lib/upload.ts`); the API has no route that takes file bytes.

## Opening protected files

Course files and handed-in submissions are served by the API behind the session (`GET /portal/me/courses/:courseId/files/:fileId`, `GET /activities/submissions/:submissionId/file`), so the app cannot just hand their URL to a browser - the browser does not have the `gb_session` cookie. Instead the app fetches the bytes itself (same cookie store as every other request), writes them to the cache directory with `expo-file-system`, and opens the share sheet with `expo-sharing` - Quick Look and "Save to Files" on iOS, "Open with" on Android. Both are native modules, so **a dev client or store build made before they were added must be rebuilt** (`eas build --profile development`, or `bunx expo prebuild` + `pod install` for a local `ios/` build).

## Build profiles

`mobile/eas.json` defines three:

| Profile | Distribution | Android artifact | For |
| --- | --- | --- | --- |
| `development` | internal | APK | A dev client you can load bundles into. Needs `expo-dev-client`, which is installed. |
| `preview` | internal | APK | A release-mode build to hand round for testing, installable without a store. |
| `production` | store | AAB | What goes to the App Store and Play. `autoIncrement` moves the build number. |

```bash
eas build --profile preview --platform ios
eas build --profile production --platform all
```

`appVersionSource` is `remote`, so EAS holds the build number rather than `app.json`. The user-facing version stays in `app.json` (`expo.version`); the build number underneath it is EAS's to increment, which is what stops two uploads colliding.

## Checklist

1. Backend deployed over HTTPS with `NODE_ENV=production`, `AUTH_SECRET`, `DATABASE_URL`, the `S3_*` storage settings, `SMTP_URL`, `CHAT_ENCRYPTION_KEY` and `STUDENT_CLAIM_CODE_PEPPER` set.
2. `AUTH_COOKIE_DOMAIN` set if the API is not a subdomain of the web app's two-label domain.
3. Give users the platform's public HTTPS URL; its API must be exposed at `/api`.
4. Build, install, select the instance, and confirm **sign-in persists across an app restart**.
5. The search and filter lists (courses, students, files, chat history, notices) use the HTTP `QUERY` method. Builds from before that send `GET` and get 404s, so once the first QUERY build is live in both stores raise `MOBILE_MIN_VERSION` to it. See [HTTP QUERY](./backend/http-query.md).

## Known gaps

- The claymorphic theme and safe-area handling were verified through Expo web and typechecks, **not on a device**.
- No build has been run through EAS from this repo, so the profiles are unexercised.
- The course screens (student and staff), file opening and rubric marking were checked with `tsc` and an iOS `expo export` bundle, and their API calls against the demo data, **not on a device**.
