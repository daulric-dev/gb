# Features (`src/features`)

Platform features the organisation switches on or off for its schools. A school's admin can additionally switch off (never on) a feature the organisation allows. Enforced on the server: a route whose feature is off answers 403 `FEATURE_DISABLED`, whatever the client shows. User-facing docs: [docs/content/backend/features.md](../../../docs/content/backend/features.md).

## The catalog

`feature.catalog.ts` defines each feature once (`key`, `label`, `description`, `default`, `requires`):

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
| `report_cards` | Report cards & transcripts | on | |
| `parent_portal` | Parent portal | off | Read-only views of a child for invited parents; each school turns it on when ready. |
| `parent_notifications` | Parent notifications | off | `parent_portal` |
| `lti` | External tools (LTI 1.3) | off | Data leaves the platform, so the organisation turns it on; a school can switch it off. |
| `timetable` | Timetable & automatic attendance | off | `attendance` |
| `attendance_alerts` | Attendance reports & alerts | off | `attendance` |
| `rostering` | Rostering sync (OneRoster, CSV) | off | Organisation-level only: checked against the organisation's setting, a school's switch has no effect. |
| `peer_review` | Peer review | on | |
| `similarity_check` | Similarity check | off | Teacher-only text similarity markers; the organisation turns it on, a school can switch it off. |
| `mastery` | Mastery & learning outcomes | off | Outcomes, alignment and mastery alongside the points gradebook; parents also need the school's `showMastery`. |
| `pastoral_notes` | Behaviour & pastoral notes | off | Private staff notes; each school turns it on when ready. |
| `ai_assistance` | AI assistance | off | Teacher-initiated AI drafts through the organisation's own provider (BYO); the organisation turns it on, a school can switch it off. |
| `analytics` | Analytics | on | Course analytics for course staff; school roll-ups need `analytics:read`. |

Effective for a school = the organisation's value AND not in the school's `disabled_features` AND every `requires` effective (`effectiveForSchool`). Without a school, the organisation's values and requirements (`effectiveForOrganisation`). `organisationSettings(stored)` applies the stored overrides to the defaults, ignoring unknown keys and non-booleans.

## What it provides

`FeaturesModule` is `@Global()` and exports `FeatureService` and `FeatureGuard`.

- `FeatureService`
  - `effective(schoolId | null)`, `isEnabled(schoolId | null, key)`, `assertEnabled(schoolId | null, key)` (throws `FeatureDisabledException`), `schoolOfUser(userId)` (active school, else a student's own).
  - `organisationFeatures()` / `updateOrganisationFeatures(patch)`: rows `{ key, label, description, enabled, default, requires }`; `enabled` is the organisation's own setting. The patch merges into `organisation.features` (unknown stored keys drop out); 400 for an unknown key or a non-boolean, 404 before setup.
  - `schoolFeatures(schoolId)` / `updateSchoolFeatures(schoolId, patch)`: rows `{ key, label, description, availableInOrganisation, enabledForSchool, effective, requires }`. `false` adds the key to `school.disabled_features`, `true` removes it; `true` for a feature the organisation does not make available (`availableInOrganisation` false) is a 400 "<Label> is turned off for your organisation".
  - Caches `features:org` and `features:school:<id>` for 30 seconds; every change drops them and the whole `profile:` prefix (profiles carry `features`).
- `FeatureGuard` + `@RequireFeature(...keys)` (`require-feature.decorator.ts`): inert without the decorator; a method's keys replace the controller's. Resolves the school like `PermissionGuard` / `StudentGuard`: `req.student.schoolId` (after `StudentGuard`), `req.parent.schoolId` (after `ParentGuard`: the linked child's school), `:schoolId`, the `:courseId`'s school, then `FeatureService.schoolOfUser`. Put it after `AuthGuard` (and `StudentGuard`).
- `FeatureDisabledException` (`feature-disabled.exception.ts`): a `ForbiddenException` with body `{ statusCode: 403, code: 'FEATURE_DISABLED', feature, message: '<Label> is turned off for your school' }`.
- `UpdateFeaturesDto` (`feature.dto.ts`): `{ features: Record<string, boolean> }`, used by both PATCH routes.

## Where each feature is enforced

| Feature | Where |
| --- | --- |
| `messaging` | `src/chat/chat.controller.ts` (class); `ChatSystemService.notifyFileShares` posts nothing while it is off. |
| `student_messaging` | `src/chat/chat-access.guard.ts` (students on every chat route) and `ChatService` (directory, starting DMs, posting to or as a student). |
| `chat_channels` | `POST /chat/channels` (`@RequireFeature('messaging', 'chat_channels')`), `ChatService.createChannel` and posting in a channel. Replaces the old `CHAT_CHANNELS_ENABLED` env var. |
| `announcements` | `src/announcement/announcement.controller.ts`, `course-announcement.controller.ts`, the portal's `GET /portal/me/courses/:courseId/announcements` and `GET /portal/me/announcements` (school posts for everyone) (`src/student-portal/student-portal.controller.ts`), and the parent portal's `GET /parent/children/:studentId/announcements` (with `parent_portal`). Off: no school announcement reaches students or parents, and the parent sweep sends no announcement notices. |
| `discussions` | `src/discussion/discussion.controller.ts`, `portal-discussion.controller.ts`. |
| `attendance` | `src/attendance/attendance.controller.ts`, `portal-attendance.controller.ts` (including `/portal/me/stream`), and the public `scan-claim.controller.ts` (school from the session's course, checked with `assertEnabled`). |
| `files` | Only the Files page's own tools: folders, moving files, sharing and share notifications (`src/file-manager/file-manager.controller.ts`). Listing, uploading (`upload-ticket`), opening, renaming and deleting your own files stay available, because course content attaches files from the file manager. Course content files (`src/course/course-file.controller.ts`, the portal's course files) are not gated. |
| `calendar` | `src/calendar/calendar.controller.ts` (staff and portal, including `.ics`). |
| `course_copy` | `src/course/course-copy.controller.ts` (templates, copy, import), `PATCH /courses/:courseId` with `isTemplate: true` (`src/course/course.controller.ts`), and the template library `src/course/library/library.controller.ts` (every `/api/library` route). |
| `pastoral_notes` | `src/pastoral/pastoral.controller.ts` (every `/api/pastoral` route). Nothing else reads pastoral notes, so there is no other place to gate. |
| `ai_assistance` | `src/ai`: the organisation console's `/api/organisation/ai/...` routes (`AiOrgFeatureGuard`: organisation value only, 403 while off), `/api/schools/current/ai` and every teacher draft route (`/api/courses/:courseId/ai`, `.../ai/quiz-questions`, `/api/courses/:courseId/pages/:pageId/ai/summary`, `/api/activities/:activityId/ai/rubric-feedback`), checked by the services against the course's or active school before anything is read or sent. A school with it off never has data sent to a provider. |
| `analytics` | `src/analytics/analytics.controller.ts` (`/api/analytics/...` and `/api/courses/:courseId/analytics...`); the summary sweep skips a school with it off (`AnalyticsService.refreshSchool`). |
| `integrations` | `src/integrations`: every webhook route (school admin and organisation console) and `WebhookEvents.emit` / the delivery worker (nothing is queued or sent for a school with it off). |
| `parent_portal` | `src/parent-portal`: every `/api/parent/...` route (`ParentPortalController`; school from the child in `:studentId`, else a linked child's school), the staff routes `/api/students/:studentId/parents/...` (active school), and redeeming an invitation or code (`ParentLinkService`, the invitation's school, with `assertEnabled`). |
| `parent_notifications` | `/api/parent/notifications/preferences` and `ParentNotificationService` (no notice is collected for a child whose school has it, or `parent_portal`, off). |
| `timetable` | `src/timetable`: every route (school setup, course timetable, `/timetable/me`, `/portal/me/timetable`), and `TimetableScheduler` opens no session for a school with it off. |
| `attendance_alerts` | `src/attendance-alerts`: every report and alert route (`@RequireFeature('attendance', 'attendance_alerts')`), the alert sweep skips a school with it off, and the parent sweep sends no `attendance_alert` notice. |
| `report_cards` | `src/report-card`: `report-comment.controller.ts`, `report-release.controller.ts`, `portal-report.controller.ts` (class); the public signed-link route checks it with `assertEnabled`; `ReportGenerationService.generate` skips a school with it off. |
| `push_notifications` | `src/notifications/push.service.ts`: `sendToUsers` drops recipients whose school has it off (checked once per school). Registration routes stay; in-app course notifications are still created. |
| `lti` | `src/lti`: course routes (`LtiCourseController`, `@RequireFeature('lti')`), organisation registry (`LtiOrganisationFeatureGuard`: organisation value only), the OIDC auth endpoint (course's school, refused with an error page), the token endpoint (organisation value, 403) and AGS (course's school, `FeatureDisabledException`). |
| `peer_review` | `src/peer-review`: staff routes check it in `PeerReviewService` against the activity's course's school (`assertEnabled`); portal routes `PortalPeerReviewController` (`@RequireFeature('peer_review')`, after `StudentGuard`); `PeerReviewScheduler`'s sweep and the late hand-in listener skip a school with it off. |
| `similarity_check` | `src/similarity`: every route checks it in `SimilarityService` (the activity's course's school, or the active school for `/schools/current/similarity`); `SimilarityService.process()` (the hand-in job) does nothing for a school with it off. No student route exists. |
| `rostering` | `src/rostering`: every `/api/organisation/rostering` route (`RosteringFeatureGuard`, organisation value only), dry runs and applies (`RosterRunService` stops while it is off) and the scheduler's daily syncs. |
| `mastery` | `src/mastery`: every `/api/mastery/...` route, the course routes `/api/courses/:courseId/outcomes`, `/outcome-alignments`, `/mastery...`, and `/api/portal/me/outcomes`; the parent route `/api/parent/children/:studentId/outcomes` (`@RequireFeature('parent_portal', 'mastery')`); `ReportDataService` adds no outcomes section while it is off. Evidence is still recorded from marks (so switching it on later shows history), but nothing is aligned unless a teacher could reach the routes. |

The routes for changing features live with their owners: `GET`/`PATCH /api/organisation/features` in `src/organisation` (organisation admins) and `GET`/`PATCH /api/schools/current/features` in `src/school` (`school:update`), plus `GET`/`PATCH /api/organisation/schools/:id/features` in `src/organisation` (organisation admins, any school; same rules). The profile's `features` map is added in `src/auth/auth.service.ts`.

## Data

- `public.organisation.features` (`jsonb`, not null, default `{}`, CHECK it is an object).
- `public.school.disabled_features` (`text[]`, not null, default `{}`).

Migration `20261102120000_features`.

## Tests

```bash
cd backend && bun test src/features
```

- `feature.catalog.test.ts`: keys, defaults, labels and requirements; overrides ignore unknown keys and non-booleans; requirements switch dependants off; a school narrows but never widens.
- `feature.service.test.ts`: effective values with and without a school, defaults before setup, the 403 body, caching and invalidation (profiles included), organisation PATCH (merge, unknown keys, 404 before setup), school PATCH (off and back on, never on past the organisation, unknown keys), `schoolOfUser`.
- `feature.guard.test.ts`: the 403 `FEATURE_DISABLED` body on representative routes of each gated controller (chat, staff and portal attendance, announcements including the portal route, files, calendar and `.ics`, course templates and copy, discussions), channels needing `chat_channels`, organisation switches, course files not gated, school resolution, and the guard being inert without metadata.
