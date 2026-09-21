---
sidebar_label: Mobile in production
sidebar_position: 7
---

# Shipping the mobile app

The app is Expo (SDK 57 / React Native 0.86) and talks to the same backend as the web app. Nothing about the API differs between the two clients; what differs is how the app is told where the backend is, and that it must be HTTPS.

## Point the build at the backend

`EXPO_PUBLIC_API_URL` is **required for a release build** and must be the backend's public HTTPS origin, with no `/api` suffix:

```
EXPO_PUBLIC_API_URL=https://api.example.com
```

Expo inlines `EXPO_PUBLIC_*` at build time, so it has to be set **when the bundle is built**, not at runtime. In EAS, put it in the profile's `env`; building locally, put it in `mobile/.env`.

In development you leave it unset: the app takes the API host from the Expo dev server it loaded from, so it follows your machine's address and survives a new DHCP lease.

A release build with it unset **throws on launch** with a message saying so. That is deliberate - the alternative is an app that installs, opens, and silently cannot reach anything, because the dev-time fallback is `localhost`, which on a phone means the phone.

## HTTPS is not optional

iOS App Transport Security is configured with `NSAllowsArbitraryLoads: false` and `NSAllowsLocalNetworking: true` - cleartext works on the local network for development and nowhere else. A production `http://` URL will fail on iOS with no useful error.

## Auth cookies

Auth is httpOnly cookies, which React Native persists in the platform's native cookie store - no token handling in app code. Two backend settings decide whether that works:

- **`NODE_ENV=production`** makes the cookie `Secure`, so the API must be HTTPS (it already must be, for ATS).
- **`AUTH_COOKIE_DOMAIN`** sets the cookie's `Domain`. If the derived default does not cover the API's own host, the client **rejects the cookie and every request after login is unauthenticated** - with no error to point at it. See [Environment variables](./environment-variables.md).

A native client has no frontend domain of its own; it only ever talks to the API host. The `Domain` attribute exists for the **web** app, whose middleware reads the cookie on its own domain.

## Direct uploads

Files upload straight to Supabase Storage over TUS, so the app needs to reach Storage as well as the API:

- `SUPABASE_JWT_SECRET` must be set on the backend, and must belong to the same project as `SUPABASE_URL`, or Storage rejects every upload.
- In production the upload endpoint is the hosted Supabase URL. The request-host derivation only applies when `SUPABASE_URL` is loopback, i.e. local development.

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

`EXPO_PUBLIC_API_URL` is present but **empty** in the `preview` and `production` profiles. It is deliberately not a placeholder like `https://api.example.com`: an unnoticed placeholder builds an app that points confidently at the wrong host, while an empty value leaves the launch guard to fire with a message naming the variable. Fill it in, or set it as an EAS environment variable, before building either profile.

## Checklist

1. Backend deployed over HTTPS with `NODE_ENV=production`, `SUPABASE_SERVICE_ROLE_KEY` (the **JWT**), `SUPABASE_JWT_SECRET`, `CHAT_ENCRYPTION_KEY` and `STUDENT_CLAIM_CODE_PEPPER` set.
2. `AUTH_COOKIE_DOMAIN` set if the API is not a subdomain of the web app's two-label domain.
3. `EXPO_PUBLIC_API_URL` set in the build profile, HTTPS, no `/api`.
4. Build, install, and confirm **sign-in persists across an app restart** - that is the check that proves the cookie was accepted.

## Known gaps

- The claymorphic theme and safe-area handling were verified through Expo web and typechecks, **not on a device**.
- No build has been run through EAS from this repo, so the profiles are unexercised.
