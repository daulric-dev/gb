---
sidebar_label: 2026-10-23 · Course gap fixes
sidebar_position: 6
---

# 2026-10-23 - Course gap fixes

Four gaps closed in courses: staff opening colleagues' module files, discussions in modules, discussion notifications, and importing content on the web.

## What it does

- **Staff open course files.** `GET /courses/:courseId/files/:fileId` lets any course staff member (teacher, TA, admin) open a file the course offers - linked by any of its module items (published or not), shared with the course, or their own - even when a colleague uploaded it. Anything else is 404. It streams like the portal route (`nosniff`, `Content-Security-Policy: sandbox`, inline filename, `private, no-store`). The web Modules page now opens file items through it instead of linking to Files.
- **Discussion topics in modules.** A module item can be a discussion topic (`{ itemType: 'discussion', discussionTopicId }`, same course only). Items carry `discussionTopicId`; students see the item only while the topic is published. The web module editor has a **Discussion** item type with a topic picker; staff and portal Modules link it to the topic. Course copy and import repoint discussion items at the copied topics and drop items for student-started topics (which are not copied).
- **Discussion notifications.** Publishing a topic notifies the course's active students (`discussion_topic`, once per topic). A reply notifies the topic author and everyone who posted in it, except the replier: students in-app (`discussion_reply`, at most one unread notice per topic, refreshed by each reply) and by push, staff by push only. Push data `{ type: 'course.discussion', courseId, topicId }`; notification items gain `topicId`.
- **Import content on the web.** Course Settings → *Copy and templates* → **Import content**: pick one of your courses or a school template, choose due-date handling, confirm, and see the counts copied.

## Deploying

Migration `20261023160000_module_discussions_notifications`:

- adds `discussion` to `course.module_item_type` and `course.module_item.discussion_topic_id` (FK to `course.discussion_topic`, cascade, indexed); the item-type check compares `item_type::text` so the new value is not used in the transaction that adds it;
- adds `course.course_notification.discussion_topic_id` (FK cascade, indexed), widens the `kind` check to `discussion_topic` and `discussion_reply`, and adds two partial unique indexes for once-per-topic and coalesced reply notices.

Apply with `bun run db:deploy`, then `bunx prisma generate`.

## Demo data and checks

`bun run seed:demo` now gives Biology 101 a **Lab write-up rubric** on the *Practice lab write-up* (left out of the final grade; Priya and Marcus marked through it), a **Microscope checklist** text file uploaded through the API and linked in Week 1, and the pinned discussion topic linked in Week 1. `bun run smoke` checks the staff file route (a TA opens Maya's module-linked file, 404 for an unlinked one), discussion items hidden from students until published, the topic and reply notifications with coalescing, and importing into a scratch course.

See [Discussion module](../../backend/discussion.md), [Course copy](../../backend/course-copy.md) and [Calendar and course notifications](../../backend/calendar-notifications.md).
