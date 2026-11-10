---
sidebar_label: Features
---

# Platform features

The organisation decides which platform features its schools get. A school's admin can then switch off (never on) any feature the organisation allows. The server enforces this on every route, so a feature that is off fails with a `403` even if a client still shows it.

Code: `backend/src/features` (see its README for the details).

## The catalog

Defined once in `backend/src/features/feature.catalog.ts`.

| Key | Label | Default | Requires |
| --- | --- | --- | --- |
| `messaging` | Messaging between staff | on | |
| `student_messaging` | Students can message their teachers | off | `messaging` |
| `chat_channels` | Group channels for staff | off | `messaging` |
| `announcements` | Announcements | on | |
| `discussions` | Discussions | on | |
| `attendance` | Attendance | on | |
| `files` | File manager & sharing | on | |
| `calendar` | Calendar | on | |
| `course_copy` | Course templates & copying | on | |
| `push_notifications` | Push notifications | on | |
| `integrations` | Integrations (webhooks) | off | Data leaves the platform, so the organisation turns it on. |
| `parent_portal` | Parent portal | off | Each school turns it on when it is ready. |
| `parent_notifications` | Parent notifications | off | `parent_portal` |
| `timetable` | Timetable & automatic attendance | off | `attendance` |
| `attendance_alerts` | Attendance reports & alerts | off | `attendance` |
| `report_cards` | Report cards & transcripts | on | |
| `rostering` | Rostering sync (OneRoster, CSV) | off | Organisation-level: a school's switch has no effect. |
| `peer_review` | Peer review | on | |
| `similarity_check` | Similarity check | off | The organisation turns it on; a school can switch it off. |
| `pastoral_notes` | Behaviour & pastoral notes | off | Private staff notes about students; each school turns it on when ready. |
| `ai_assistance` | AI assistance | off | Teacher-approved AI drafts through the organisation's own AI provider; the organisation turns it on, a school can switch it off. |
| `analytics` | Analytics | on | Course analytics for teachers; the school page needs the `analytics:read` permission. |
| `mastery` | Mastery & learning outcomes | off | |

**Effective for a school** = the organisation's value AND the school has not switched it off AND every feature it requires is effective. Without a school (an organisation admin with none), the organisation's values and requirements decide.

Group channels used to be the `CHAT_CHANNELS_ENABLED` environment variable; that variable is gone, switch on `chat_channels` instead.

## Storage

- `public.organisation.features` (`jsonb`, default `{}`): `key → boolean` overrides of the defaults. Unknown keys are ignored.
- `public.school.disabled_features` (`text[]`, default `{}`): the keys the school switched off.

Added by migration `20261102120000_features`. Lookups are cached for 30 seconds and dropped on every change, together with every cached profile.

## API

### Organisation (organisation admins)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/organisation/features` | | `[{ key, label, description, enabled, default, requires }]` |
| PATCH | `/api/organisation/features` | `{ features: { [key]: boolean } }` | the same list; `400` for an unknown key or a non-boolean |

`enabled` is the organisation's own setting (its override, else the default). A feature can be `enabled` and still not work when something in `requires` is off; clients show it as unavailable.

### School (`school:update` in the active school)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/schools/current/features` | | `[{ key, label, description, availableInOrganisation, enabledForSchool, effective, requires }]` |
| PATCH | `/api/schools/current/features` | `{ features: { [key]: boolean } }` | the same list |

`false` switches a feature off for the school; `true` switches it back on, and is a `400` "&lt;Label&gt; is turned off for your organisation" when the organisation does not allow it (`availableInOrganisation` is false).

### The profile

`GET /api/auth/me` (and the other responses that return the profile with `is_org_admin`) carries `features: { [key]: boolean }`, the effective values for the user's active school, or the organisation's without one.

### When a feature is off

```json
{
  "statusCode": 403,
  "code": "FEATURE_DISABLED",
  "feature": "attendance",
  "message": "Attendance is turned off for your school"
}
```

## Where it is enforced

`@RequireFeature(...keys)` with `FeatureGuard` resolves the school like `PermissionGuard` and `StudentGuard`: the student's school on portal routes, the route's `:schoolId`, the `:courseId`'s school, then the caller's active school.

| Feature | Enforced on |
| --- | --- |
| `messaging` | Every `/api/chat` route. Also: no "shared a file with you" chat message is posted. |
| `student_messaging` | Students on `/api/chat` (see [Chat](./chat.md)); staff writing to a student. |
| `chat_channels` | `POST /api/chat/channels` and posting in an existing channel. |
| `announcements` | `/api/announcements`, `/api/courses/:courseId/announcements`, `GET /api/portal/me/courses/:courseId/announcements`, `GET /api/portal/me/announcements`, `GET /api/parent/children/:studentId/announcements` |
| `discussions` | `/api/courses/:courseId/discussions`, `/api/portal/me/courses/:courseId/discussions` |
| `attendance` | `/api/courses/:courseId/attendance`, the portal's attendance routes and stream (`/api/portal/me/attendance/...`, `/api/portal/me/courses/:courseId/attendance`, `/api/portal/me/stream`) and the public `POST /api/attendance/scan-claim` (school from the session's course) |
| `files` | The Files page's own tools under `/api/files`: folders, moving files, sharing and share notifications. Listing, uploading, opening, renaming and deleting your own files stay available, because course content attaches files from the file manager; course content files (`/api/courses/:courseId/files`, the portal's course files) are not gated. |
| `calendar` | `/api/calendar`, `/api/calendar/ics`, `/api/portal/me/calendar`, `/api/portal/me/calendar/ics` |
| `course_copy` | `GET /api/courses/templates`, `POST /api/courses/:courseId/copy`, `POST /api/courses/:courseId/import`, `PATCH /api/courses/:courseId` with `isTemplate: true`, and every `/api/library/...` route (the course template library) |
| `integrations` | Every webhook route (`/api/schools/current/webhooks/...`, `/api/organisation/schools/:schoolId/webhooks/...`); no events are queued and no deliveries are sent for a school with it off. See [webhooks.md](./webhooks.md). |
| `parent_portal` | Every `/api/parent/...` route, `/api/students/:studentId/parents/...`, and redeeming a parent invitation or code. See [the parent portal guide](../guide/parent-portal.md). |
| `parent_notifications` | `/api/parent/notifications/preferences`; no parent notice is sent for a child whose school has it off. |
| `timetable` | `src/timetable` (school setup, course timetables, `/timetable/me`, `/portal/me/timetable`); no session opens automatically while it is off. |
| `attendance_alerts` | `src/attendance-alerts` (reports, CSV, alerts, settings, form tutors); no alerts are opened and no parent `attendance_alert` notice is sent while it is off. |
| `report_cards` | `/api/courses/:courseId/report-comments`, every `/api/report-cards/...` route (release dashboard and signed report links), and `/api/portal/me/reports...` / `/api/portal/me/transcript...`; queued PDF jobs for a school with it off do nothing. See [the report cards guide](../guide/report-cards.md). |
| `rostering` | Every `/api/organisation/rostering/...` route (organisation admins; checked against the organisation's setting only), dry runs, applies and daily syncs. See [the rostering guide](../guide/rostering.md). |
| `peer_review` | `/api/activities/:activityId/peer-review/...` (checked by the service against the activity's course's school) and `/api/portal/me/peer-reviews...`, `/api/portal/me/activities/:activityId/peer-review` (`FeatureGuard`); the sweep opens no window and sends no notice for a school with it off, and a late hand-in allocates nothing. See [work and grading](../guide/work-and-grading.md#peer-review). |
| `similarity_check` | `/api/activities/:activityId/similarity/...` and `/api/schools/current/similarity` (checked by the service against the course's / active school); the hand-in job does nothing for a school with it off. There are no student routes. See [work and grading](../guide/work-and-grading.md#similarity-check). |
| `pastoral_notes` | Every `/api/pastoral/...` route. Nothing else reads the notes. See [pastoral notes](../guide/pastoral-notes.md). |
| `ai_assistance` | `/api/organisation/ai/...` (organisation value), `/api/schools/current/ai` and the teacher draft routes `/api/courses/:courseId/ai...`, `/api/courses/:courseId/pages/:pageId/ai/summary`, `/api/activities/:activityId/ai/rubric-feedback` (the course's / active school). Nothing is sent to a provider for a school with it off. See [AI assistance](../guide/ai-assistance.md). |
| `analytics` | `/api/analytics/...` and `/api/courses/:courseId/analytics...`; the hourly summary refresh skips a school with it off. See [analytics](../guide/analytics.md). |
| `mastery` | `/api/mastery/...` (school scale and outcome sets), `/api/courses/:courseId/outcomes`, `/outcome-alignments` and `/mastery...`, `/api/portal/me/outcomes`, and with `parent_portal` `/api/parent/children/:studentId/outcomes`; report cards add no outcomes section while it is off. See [the mastery guide](../guide/mastery.md). |
| `push_notifications` | `PushService` sends nothing to users whose school has it off. Device registration still works, and in-app course notifications are still created. |
