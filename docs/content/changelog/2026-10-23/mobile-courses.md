---
sidebar_label: 2026-10-23 · Courses in the mobile app
sidebar_position: 5
---

# 2026-10-23 - Courses in the mobile app

Until now the app had a course list, grades, the calendar and attendance; everything inside a course was web-only. The app now has a full course screen for students and a working one for staff. Building course content (modules, pages, quizzes, rubrics, settings) stays on the web, and the app says so where it applies.

## Students

Tapping a course on **Home** opens `/course/:courseId`, with sections along the top:

- **Home** - the course description (Markdown), who teaches it, up to five pieces of upcoming work and the three latest announcements.
- **Modules** - modules and their items in order, headings as labels. A **page** opens in the app rendered from Markdown; **work** opens the work screen; a **link** opens in the browser; a **file** is downloaded with the session (`GET /portal/me/courses/:courseId/files/:fileId`) and handed to the phone's viewer and share sheet.
- **Work** - the course's work split into *To do* and *Everything else*, with marks, Excused, Missing, Handed in and Closed states.
- **Grades** - the course total and letter, linking to the existing grade breakdown screen.
- **Announcements**, rendered as Markdown.
- **Discussions** - the topic list (pinned first, unread counts, Locked / Post first / Draft badges), a topic screen with one-level threaded replies, reply / edit / delete of your own posts, **New topic** when the course allows it, and the "post before seeing replies" notice when `mustPostFirst` is set.
- **Attendance** - rate and counts, every session with your status, and a shortcut to **Scan attendance QR**.

`?tab=announcements` (or any section name) opens a section directly.

The **work screen** now renders instructions and feedback as Markdown, shows scores to two decimals, shows **Excused**, and shows the **rubric** up front - and, once marked, the level picked for each criterion with any comment and the rubric total. Hand-in (text and/or a file through the presigned upload) and quiz taking, results and retakes are unchanged.

**Notifications:** an announcement push now opens the course on its Announcements section (it used to open the grades screen, the only course view there was); a new-work push still opens the work screen. The Calendar tab's notices follow the same rule.

## Staff

**More → Courses** (`/teaching`) lists the courses you teach (all of them for a school admin); a course on the teacher dashboard opens too. The course screen (`/teaching/:courseId`) has:

- **Marking** - the course's work; open one for its roster with *Handed in / To mark / Marked* counts and a filter. Tapping a student opens marking: their text, their file (downloaded via `GET /activities/submissions/:submissionId/file` and opened in the viewer), a score from 0 to the work's points with at most two decimals, feedback (with a Markdown preview), **Excuse / Remove excuse**, and **Previous / Next** through the roster. With a rubric, tapping a level per criterion fills the score with their sum, which can be overridden; it saves through `PUT /activities/:activityId/submissions/:studentId/rubric`, otherwise `PATCH .../grade`.
- **Modules** - read-only, drafts marked, with a publish switch per module for teachers and admins (`PATCH /courses/:courseId/modules/:moduleId`). Pages open read-only.
- **Announcements** - post, edit and delete (your own, or any as a teacher) through `/courses/:courseId/announcements`.
- **Discussions** - the same topic screens as students, with staff moderation: pin, lock, publish, "post first", and editing or deleting any post the API allows.
- **Gradebook** - read-only: every student's total, letter and bar; tap one for their group breakdown and every mark, and a mark to open its marking screen.
- **People** - staff with their roles and the student roster.
- **Take attendance** at the top of a published course, as before.

## Under the hood

- A small built-in Markdown renderer (`mobile/src/components/ui/Markdown.tsx`): headings, paragraphs, bold / italic / strike / code, links (http, https and mailto only), lists, quotes, fenced code, rules and tables. Raw HTML is never interpreted. No dependency was added for it.
- Shared pieces under `mobile/src/features/course/` (module list, rubric view, announcement list, page screen, student and staff sections) and `mobile/src/features/discussions/` (topic list, topic screen, topic editor), used by both audiences with the student or staff API base.
- `AnnouncementForm` takes a `basePath`, so the school-wide and course announcement screens share it.

## Also in this release

- **Staff file opening** - a file in a module now opens for any staff member of the course, including one a colleague uploaded, through `GET /api/courses/:courseId/files/:fileId` (it used to go through the uploader-only `/files/:id/content`).
- **Discussions in modules** - module items of type `discussion` show with a discussion icon and open the topic: `/course/:courseId/discussion/:topicId` for students, `/teaching/:courseId/discussion/:topicId` for staff. Students only get items for published topics.
- **Discussion notifications** - `discussion_topic` and `discussion_reply` notices show in the Calendar tab's notices with a discussion icon and a "New discussion" / "Discussion reply" label, and open the topic. A `course.discussion` push (`{ courseId, topicId }`) opens the topic on the student or staff screen depending on who is signed in; it is the only push that routes for staff.
- **Dropped marks** - marks left out by a group's drop rules are greyed and struck through with a **Dropped** label on the student grade breakdown and in the staff gradebook's student sheet, the same way **Excused** is shown. Group lines show the rule ("drop lowest 2"), the course Grades section says how many marks were dropped. All of this is read from optional fields, so an older server simply shows nothing extra.

## Deploying

- New mobile dependencies: **`expo-file-system`** and **`expo-sharing`** (installed with `expo install` for SDK 57; `expo-sharing`'s config plugin was added to `app.json`). Both are native modules: **rebuild the dev client and store builds** before using a build that includes these screens.
- The staff file route, discussion module items, discussion notifications and drop-rule fields come from the backend changes in the same release; with an older backend those calls 404 or the fields are absent and the app degrades quietly. No migrations or environment variables on the mobile side.
- Not yet exercised on a device; checked with `tsc`, an iOS `expo export` bundle, and the API calls against the demo data. The demo data has no rubrics or module files, so rubric marking and file opening have not been run end to end.
