---
sidebar_label: 2026-10-23 · Calendar and new-work notifications
sidebar_position: 1
---

# 2026-10-23 - Calendar and new-work notifications

A calendar of due dates for staff and students, and notifications to students when work is published or a course announcement is posted.

## Calendar

- **Staff** (`/dashboard/calendar`, in the sidebar): a month grid of due dates across every course you teach or assist, drafts included (dashed), coloured by course. Pick a day for its list; each item opens the assignment.
- **Students** (`/portal/calendar`, in the portal nav): the same grid over published and closed work in their published courses, with each item's state (handed in, marked, missing, closed).
- **Export .ics** on both downloads the visible range for Google Calendar, Outlook or Apple Calendar. It is a one-off file, not a live feed.
- **Mobile**: a **Calendar** tab for students listing the next 60 days by day, with unread notices at the top.

API: `GET /calendar`, `GET /calendar/ics`, `GET /portal/me/calendar`, `GET /portal/me/calendar/ics`, all taking `from` / `to` (at most 400 days). See [Calendar and course notifications](../../backend/calendar-notifications.md).

## Notifications when new work is posted

Publishing an activity, or posting an announcement in a course, now notifies the course's active students:

- an in-app notice - the portal header has a **bell** with an unread count; opening a notice marks it read and goes to the work or the course's announcements;
- an Expo push to their devices - tapping it opens the activity (or, for an announcement, the course) in the app.

Draft courses never notify. Closing and reopening work does not notify the same student twice. Delivery is fire-and-forget: publishing does not wait on it and failures are only logged.

API: `GET /portal/me/notifications`, `GET /portal/me/notifications/unread-count`, `POST /portal/me/notifications/read`, `POST /portal/me/notifications/read-all`.

## Deploying

- Migration `20261023120000_notifications_calendar` adds `course.course_notification`. Apply with `bun run db:deploy`; nothing to backfill.
- The mobile app creates a new Android notification channel, `coursework` ("New work and announcements"). Android users on an older build still receive these pushes on the default channel until they update.
- No new environment variables. Pushes use the existing `EXPO_ACCESS_TOKEN` if set.
