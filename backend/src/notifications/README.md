# Notifications (`src/notifications`)

Mobile push notifications through Expo. Signed-in users (staff or students) register their device's Expo push token here, and other features send pushes to a list of user ids through `PushService`. This module only delivers pushes: it does not decide when to notify anyone. Course notices and attendance decide that and call `sendToUsers()`.

A token belongs to whoever registered it last, so a shared phone stops notifying its previous owner. Sending is best effort. It never throws, and a token that Expo reports as `DeviceNotRegistered` is deleted.

(The file-sharing inbox at `/api/files/notifications` is a different thing and lives in `file-manager`.)

## What it provides

### HTTP routes

| Method | Path | Guard | What it does |
| --- | --- | --- | --- |
| POST | `/api/notifications/devices` | `AuthGuard` (any signed-in user) | Register this device's token for the caller, taking it over from any earlier owner. Body: `RegisterPushDeviceDto`. Returns 204. |
| DELETE | `/api/notifications/devices/:token` | `AuthGuard` | Remove the token, but only if it belongs to the caller. Returns 204. |

### Services / exports

`NotificationsModule` exports `PushService`. The module is not global, so a feature that sends pushes has to import it.

- `register(userId, token, platform)`: upsert on the token (trimmed), setting `user_id`, `platform` and `last_seen_at`. A database error becomes a 400.
- `unregister(userId, token)`: delete where both the user and the token match.
- `sendToUsers(userIds, { title, body, data?, channelId? })`: load every device of the de-duplicated users, keep only tokens that look like Expo tokens (`ExpoPushToken[...]` or `ExponentPushToken[...]`), and POST them to `https://exp.host/--/api/v2/push/send` in chunks of 100. Each message has `sound: 'default'` and `priority: 'high'`. `channelId` names the Android notification channel the app created. Tokens Expo calls `DeviceNotRegistered` are deleted; other ticket errors are logged.
- `fetchImpl` can be replaced in tests.
- Also exported: `EXPO_PUSH_URL`, and the `PushMessage` and `PushPlatform` types.

## Used by

- `src/course-notification/course-notification.service.ts` sends course pushes (activity published, announcement posted, discussion topic published, discussion reply) on its course channel. `course-notification.module.ts` imports `NotificationsModule`.
- `src/attendance/attendance.service.ts` sends "attendance is open" pushes (`channelId: 'attendance'`, `data.type: 'attendance.opened'`). `attendance.module.ts` imports `NotificationsModule`.
- `src/app.module.ts` imports `NotificationsModule`, which registers the controller.
- `mobile/src/lib/push.ts` calls `POST /notifications/devices` after getting an Expo token, and `DELETE /notifications/devices/:token` from `unregisterPush()` before the session ends.

## Depends on

- `PrismaService` (global).
- The Expo push HTTP API, reached with the global `fetch`.

## Data

`public.push_device` (`token` is unique; `user_id`, `platform`, `last_seen_at`). See [`prisma/schema/school.prisma`](../../prisma/schema/school.prisma).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `EXPO_ACCESS_TOKEN` | unset | When set, sent as `Authorization: Bearer ...` to Expo (needed if push security is enabled on the Expo project) |

## Files

| File | Purpose |
| --- | --- |
| `notifications.module.ts` | Module: controller plus `PushService` (exported) |
| `notifications.controller.ts` | Device register and unregister routes |
| `push.service.ts` | Device storage and sending through Expo |
| `push.service.test.ts` | Tests for sending and device handling |
| `dto/` | Request DTO, see [`dto/README.md`](dto/README.md) |

## Tests

`cd backend && bun test src/notifications`. Covers chunking into 100s and skipping non-Expo tokens, forgetting `DeviceNotRegistered` tokens (and only those), doing nothing without users or devices, never throwing when Expo fails, sending the access token, register taking a token over, and unregister touching only the caller's own token.

## See also

- [`docs/content/backend/calendar-notifications.md`](../../../docs/content/backend/calendar-notifications.md)
