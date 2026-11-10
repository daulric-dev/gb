# Course notifications (`src/course-notification`)

This module tells a course's students when something new appears in it: an activity is published (or reopened), a course announcement is posted, a discussion topic goes up, or someone replies in a discussion they are part of. Each event writes one in-app notice per recipient into `course.course_notification` (what the student portal's bell and the mobile inbox list) and sends an Expo push notification to their devices on the Android `coursework` channel. It also serves the student's own notice list, unread count and read markers. All event methods are best effort: callers fire and forget, nothing throws back into the request that published the work, and failures are only logged.

## What it provides

### HTTP routes

All under `AuthGuard` + `StudentGuard`. Notices belong to the signed-in account (`req.user.id`), so there is no id in the path.

| Method | Path | Who | What it does |
|--------|------|-----|--------------|
| QUERY | `/api/portal/me/notifications` (body `{ limit?, before?, unread? }`) | Student | `CourseNotification[]`, newest first. `limit` default 30, max 100; `before` pages back by `createdAt`; `unread: true` for unread only. |
| GET | `/api/portal/me/notifications/unread-count` | Student | `{ count }` of unread notices. |
| POST | `/api/portal/me/notifications/read` | Student | Mark the given `ids` read (`204`). Ids that are not the caller's are ignored. |
| POST | `/api/portal/me/notifications/read-all` | Student | Mark every unread notice read (`204`). |

### Services / exports

`CourseNotificationModule` is `@Global()` and exports `CourseNotificationService`, so grading, announcements and discussions can inject it without importing the module (and without an import cycle through the student portal, whose `StudentGuard` is provided here directly).

Event methods (never throw):

- `activityPublished(courseId, { id, title, kind })` - notice titled "New quiz: ..." or "New work: ...". A student already told about this activity is not told again, so reopening does not repeat it.
- `announcementPosted(courseId, { id, title, body })` - notice with the announcement title and a one-line body preview (whitespace collapsed, 140 characters max).
- `schoolAnnouncementPosted(schoolId, { id, title, body })` - a school-wide announcement for everyone was posted (or widened from staff only): a push (`School announcement: <title>`, `data.type` `school.announcement`, `announcementId`) to every active student of the school with an account. No in-app row (notices belong to a course). `push_notifications` is applied by `PushService`.
- `discussionTopicPublished(courseId, { id, title, body, authorUserProfileId })` - "New discussion: ..."; each student is told once per topic and the author is excluded.
- `peerReviewAssigned(courseId, { id, title }, studentIds)` - "Peer review: <title>" to the given students (reviewers), once per student and activity.
- `peerReviewsReady(courseId, { id, title }, studentIds)` - "Reviews ready: <title>" to the given authors, once per student and activity. Both reach only actively enrolled students with an account; push `data.type` `course.peer_review` with `courseId` and `activityId`.
- `discussionReplied(courseId, topic, reply)` - tells the topic author and everyone who has posted in the topic, except the replier. Actively enrolled students get an in-app notice (at most one unread `discussion_reply` per topic, refreshed with the latest reply) and a push; course staff get the push only.

Only courses with status `published` produce notices. Recipients are the accounts (`student.user_profile_id`) of students with an `active` enrolment who are not deactivated and have signed up.

Recipient methods: `list(userId, opts)`, `unreadCount(userId)`, `markRead(userId, ids)`, `markAllRead(userId)`.

### Other

- `CourseNotification` and `CourseNotificationKind` types (`activity_published`, `announcement`, `discussion_topic`, `discussion_reply`, `peer_review_assigned`, `peer_review_ready`).
- `COURSE_CHANNEL = 'coursework'`, the Android notification channel the mobile app creates for course news (mirrored in `mobile/src/lib/push.ts`).
- Push payload `data.type` values: `course.activity_published`, `course.announcement`, `course.discussion` (and `school.announcement`, which opens portal home in the app), with `courseId` and `activityId` / `announcementId` / `topicId`, used by the mobile app to route a tapped notification.

## Used by

- `src/app.module.ts` imports `CourseNotificationModule`.
- `src/grading/activity.service.ts` calls `activityPublished` after publishing an activity.
- `src/announcement/announcement.service.ts` calls `announcementPosted` for course announcements and `schoolAnnouncementPosted` for school announcements for everyone.
- `src/discussion/discussion.service.ts` calls `discussionTopicPublished` and `discussionReplied`.
- `src/peer-review/peer-review.service.ts` calls `peerReviewAssigned` and `peerReviewsReady`.
  All three inject the service as `@Optional()`.
- Web: `frontend/lib/portal-notifications.ts` (list, unread count, read, read-all) used by `frontend/app/portal/_components/notification-bell.tsx`; types in `frontend/lib/courses/types.ts`.
- Mobile: `mobile/app/(portal)/calendar.tsx` shows unread notices and marks them read; `mobile/src/lib/calendar.ts` maps a notice to a screen (`noticeHref`), also used by `mobile/src/providers/NotificationRouter.tsx`.
- `backend/scripts/smoke.ts` exercises listing, unread count, read and read-all.

## Depends on

- `PrismaService` (global).
- `PushService` from `NotificationsModule` (`src/notifications/`), imported by this module.
- `StudentGuard` from `src/student-portal/student.guard.ts`, `AuthGuard` from `src/auth/`.
- `isoDate` from `src/common/db-values.ts`.

## Data

- `course.course_notification` - read/write (`prisma/schema/course.prisma`). Partial unique keys on (user, activity) per kind (`activity_published`, `peer_review_assigned`, `peer_review_ready`; migration `20261124100000_peer_review`), (user, topic) and a partial unique index for unread reply notices prevent duplicates.
- Read: `course.course`, `course.course_student`, `course.course_staff` (`course.prisma`), `student.student` (`student.prisma`), `course.discussion_reply` (`discussion.prisma`), `public.user_profile` (`school.prisma`).

## Configuration

None directly. Push delivery depends on the configuration of `PushService`.

## Files

| File | Purpose |
|------|---------|
| `course-notification.module.ts` | Global module; imports `NotificationsModule`, provides `StudentGuard`, exports the service. |
| `course-notification.controller.ts` | `/portal/me/notifications` routes. |
| `course-notification.service.ts` | Event methods (write notices, send pushes) and the recipient's list / count / read methods. |
| `dto/course-notification.dto.ts` | `ListCourseNotificationsQueryDto`, `MarkCourseNotificationsReadDto`. See [dto/README.md](dto/README.md). |
| `course-notification.service.test.ts` | Unit tests with mocked Prisma and push. |

## Tests

```bash
cd backend && bun test src/course-notification
```

Covered: a notice and push per active student for new work; reopened work only reaching students not told before; draft courses telling nobody; announcement body previews; events never throwing when the database fails; a published topic telling the class once but not its author; replies reaching the author and posters (students in-app, staff by push) and coalescing into one unread notice; list shaping and scoping to the caller; mark-read touching only the caller's own notices.

## See also

- [Calendar and course notifications](../../../docs/content/backend/calendar-notifications.md)
- [calendar README](../calendar/README.md), [discussion README](../discussion/README.md)
