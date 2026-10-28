# App version (`src/app-version`)

Tells the mobile app whether it is out of date, and refuses API calls from builds that are too old to be served. The app checks `GET /api/app/version` on launch and on returning to the foreground: below `minimum` it shows a blocking "Update required" screen, below `latest` it offers the update once per release. Every app request also carries `X-GradeBook-App-Version`; a build below the minimum gets `426 Upgrade Required` from any route, so an app that skipped the check still lands on the update screen.

## What it provides

- **HTTP routes**

  | Method | Path | Access | Notes |
  | --- | --- | --- | --- |
  | GET | `/api/app/version` | Public, default throttler | `{ ios: { minimum, latest, storeUrl }, android: { ... } }`, each `null` when unset. `Cache-Control: public, max-age=300`. Not versioned (no transformer). |

- **Services / exports** - `AppVersionService` (`versions()`, `updateRequired(header)`).
- **Other**
  - `AppVersionGuard` - registered as an `APP_GUARD` by `AppVersionModule`, so it runs on every route. Only acts when the request has `X-GradeBook-App-Version` (browsers and scripts never send it). The header is `ios/1.4.0`, `android/1.4.0`, or a bare `1.4.0`, which is held to the lower of the two platform minimums (and never refused unless both are set). A header it can't read is ignored. Below the minimum: `426 { statusCode, code: 'update_required', message, storeUrl }`. `/api/app/version` and `/api/auth/logout` are always allowed; `/health` is a raw Fastify route and never reaches the guard.
  - `app-version.config.ts` - `parseVersion`, `compareVersions` (numeric MAJOR.MINOR.PATCH; missing parts are 0; a `-pre`/`+build` suffix is ignored), `parseClientVersion`, `loadAppVersionConfig`.

## Used by

- `src/app.module.ts` imports `AppVersionModule`.
- `src/createApp.ts` allows the `X-GradeBook-App-Version` header in CORS.
- The mobile app: `mobile/src/lib/app-update.ts` (check and 426 handling), header sent from `mobile/src/lib/session-token.ts`.

## Depends on

Nothing but `@nestjs/common` / `@nestjs/core`.

## Data

None. Configuration is read once at boot.

## Configuration

| Variable | Meaning |
| --- | --- |
| `MOBILE_MIN_VERSION` | Minimum version for both platforms. |
| `MOBILE_LATEST_VERSION` | Latest release for both platforms (defaults to the minimum). |
| `MOBILE_MIN_VERSION_IOS`, `MOBILE_MIN_VERSION_ANDROID` | Per-platform minimum, overriding the shared one. |
| `MOBILE_LATEST_VERSION_IOS`, `MOBILE_LATEST_VERSION_ANDROID` | Per-platform latest, overriding the shared one. |
| `MOBILE_IOS_STORE_URL`, `MOBILE_ANDROID_STORE_URL` | Store page the app opens for "Update" (https). |

All optional; unset means no requirement. A malformed version or a non-https store URL throws at boot in production (fail closed) and is warned about and ignored in development. A `latest` below the `minimum` is raised to the minimum with a warning. Raise the minimum only after the new build is live in both stores, or users are locked out with nothing to update to.

## Files

| File | Purpose |
| --- | --- |
| `app-version.module.ts` | Module; registers the controller, service and global guard. |
| `app-version.controller.ts` | `GET /api/app/version`. |
| `app-version.service.ts` | Holds the config; decides whether a header is below the minimum. |
| `app-version.guard.ts` | Global 426 guard. |
| `app-version.config.ts` | Version parsing / comparison and env loading. |
| `app-version.test.ts` | Tests for all of the above. |

## Tests

`bun test src/app-version`.
