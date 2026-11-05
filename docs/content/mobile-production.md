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

If the frontend and backend have different public hostnames, the frontend
should publish `/.well-known/gradebook.json` with the API's public origin:

```json
{ "apiUrl": "https://api.school.example.com" }
```

The mobile app accepts the frontend URL, reads this file, then checks the
advertised backend's `/health` endpoint. Direct backend URLs continue to work
when no discovery file is present. The discovery document is public by design:
it contains only a server address, not credentials or school data. It does not
grant account or school access. The backend still enforces email verification,
configured SSO requirements, school memberships, join codes and join-request
approval on their respective flows. Keep the frontend's `NEXT_PUBLIC_API_URL`
set to the public backend origin when building it; this value is exposed in the
discovery document.

Only enter a server address provided by a trusted school. Sign-in details are
sent directly to the selected instance. The choice is stored securely on iOS
and Android; development builds may still use `EXPO_PUBLIC_API_URL` or discover
the API from the Expo dev server.

## HTTPS is not optional

iOS App Transport Security is configured with `NSAllowsArbitraryLoads: false` and `NSAllowsLocalNetworking: true` - cleartext works on the local network for development and nowhere else. A production `http://` URL will fail on iOS with no useful error.

## Mobile authentication

The API issues an opaque session token (not a JWT). The app receives it in
`X-Session-Token`, stores it in the device keychain or keystore, and sends it
as `Authorization: Bearer ...` on API requests. This token represents the
server-side session; the database stores its hash, and the session can be
revoked from Signed-in devices. The web app uses the separate `gb_session`
HTTP-only cookie.

The app also sends `X-GradeBook-Client: native` so the API can identify native
sign-ins and return the session token safely. Mobile SSO completes through
`POST /auth/sso/handoff`, which exchanges a one-time code for the same kind of
server-side session token.

For multi-replica deployments, set `USE_REDIS=true` and configure every API
replica with the same `REDIS_URL`. The shared cache lets revocation invalidate
cached sessions across replicas promptly. Without shared Redis, another
replica may continue accepting a cached session briefly.

## Direct uploads

Files upload straight to object storage (S3-compatible) with presigned URLs, so the app needs to reach storage as well as the API:

- The backend signs upload URLs for `S3_PUBLIC_ENDPOINT` (or `S3_ENDPOINT` when unset). That host must be reachable from the phone - in production an HTTPS endpoint such as `https://<account-id>.r2.cloudflarestorage.com`; in development a LAN address, not `127.0.0.1`.
- The app sends exactly the headers in the upload ticket and no cookies, then calls the ticket's `complete` route so the backend can check and release the file. A `503` from `complete` (the server is busy checking other uploads) is retried a few times with backoff; the file stays pending meanwhile.
- Assignment hand-ins, **Files** uploads and the profile picture all use this path (`src/lib/upload.ts`); the API has no route that takes file bytes.

## Opening protected files

Course files and handed-in submissions are served by the API behind the session (`GET /portal/me/courses/:courseId/files/:fileId`, `GET /activities/submissions/:submissionId/file`), so the app cannot just hand their URL to a browser - the browser does not have the app's bearer token. Instead the app fetches the bytes itself with its session token, writes them to the cache directory with `expo-file-system`, and opens the share sheet with `expo-sharing` - Quick Look and "Save to Files" on iOS, "Open with" on Android. Both are native modules, so **a dev client or store build made before they were added must be rebuilt** (`eas build --profile development`, or `bunx expo prebuild` + `pod install` for a local `ios/` build).

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
