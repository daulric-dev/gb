---
sidebar_label: Discussion
---

# Discussion Module

**Location**: `backend/src/discussion/`

Course discussion forums. Staff start topics (a title and a Markdown body); everyone in the course replies, threaded one level deep. Each caller has a per-topic read marker that drives reply and unread counts on the topic list.

## Files

| File | Purpose |
|------|---------|
| `discussion.module.ts` | Module definition; imports `StudentPortalModule` for `StudentGuard` |
| `discussion.controller.ts` | Staff routes, `courses/:courseId/discussions` |
| `portal-discussion.controller.ts` | Student routes, `portal/me/courses/:courseId/discussions` |
| `discussion.service.ts` | Access rules, threading, soft delete, unread counts |
| `dto/discussion.dto.ts` | Topic, reply and settings bodies |

## Data model (`course` schema)

Migration `20261023140000_discussions`; Prisma models in `prisma/schema/discussion.prisma`.

| Table | Columns |
|-------|---------|
| `discussion_topic` | `id`, `course_id`, `author_user_profile_id`, `title`, `body` (Markdown), `is_pinned`, `is_locked`, `is_published`, `require_initial_post`, `last_reply_at`, `edited_at`, `created_at`, `updated_at` |
| `discussion_reply` | `id`, `topic_id`, `course_id`, `parent_id` (null = top level), `author_user_profile_id`, `body`, `edited_at`, `deleted_at`, `created_at` |
| `discussion_read` | `(topic_id, user_profile_id)` PK, `last_read_at` |
| `discussion_setting` | `course_id` PK, `students_can_create_topics` (default false); no row = defaults |

Staff and students both post as their `user_profile` (a student account is a user profile linked to a `student` row), so authorship is one nullable column; deleting an account sets it to null and the post shows as "Former member". Topics, replies and read markers cascade with the course; replies cascade with their topic and parent.

## Who can do what

| | Staff (teacher, admin) | TA | Student |
|---|---|---|---|
| Read | every topic, drafts included | every topic | published topics, active enrolment, published or archived course |
| Start a topic | yes | yes | only when `students_can_create_topics`; always published, no flags |
| Reply | yes, even in a locked topic | unless locked | unless locked |
| Edit / delete own post | yes | yes | yes (not in an archived course or a locked topic; a topic only while nobody else has replied) |
| Edit / delete others' posts, pin, lock, publish | yes | no | no |
| Change the course setting | yes | no | no |

An archived course takes no new topics or replies from anyone; staff can still edit and delete. A course the caller has no part in is a 404 (via `CourseAccessService.require` / `requireStudent`), as is a draft topic for a student.

## Threading and deletion

- `parentId` on a new reply may name any reply in the topic. Answering a nested reply attaches to its top-level parent, so threads never go deeper than one level. Replying to a deleted post is a 400.
- Deleting a reply with answers **soft-deletes** it: `deleted_at` is set and `body` cleared; it is returned with `isDeleted: true`, an empty body and no author. A reply without answers is removed outright, and if that leaves a soft-deleted parent with no answers, the parent goes too.

## Post before seeing replies

When `require_initial_post` is set, a student who has not posted gets the topic with `mustPostFirst: true` and `replies: []`, and the topic is not marked read. Staff always see everything.

## Unread tracking

Opening a topic (`GET .../:topicId`) upserts `discussion_read.last_read_at`. The list computes, per topic, `replyCount` (live replies) and `unreadCount` (live replies by others newer than the caller's marker) in one grouped query, and `isRead` (the caller has opened it, or wrote it). In a topic, each reply carries `isNew` against the marker as it stood before this visit.

## Endpoints

Staff: `AuthGuard`, course role checked in the service. Student: `AuthGuard + StudentGuard`; the student is always the one the guard resolved.

| Method | Staff route | Student route | Notes |
|--------|-------------|---------------|-------|
| GET | `/courses/:courseId/discussions` | `/portal/me/courses/:courseId/discussions` | `{ studentsCanCreateTopics, canCreateTopics, topics }` |
| POST | `/courses/:courseId/discussions` | `/portal/me/courses/:courseId/discussions` | `{ title, body?, isPinned?, isLocked?, isPublished?, requireInitialPost? }` (flags ignored for students) |
| GET | `.../discussions/:topicId` | same | topic with `body`, `mustPostFirst`, `canReply`, `replies` (tree); marks read |
| PATCH | `.../discussions/:topicId` | same | same fields as create; flags 403 for students |
| DELETE | `.../discussions/:topicId` | same | 204; students get 409 once others have replied |
| POST | `.../discussions/:topicId/replies` | same | `{ body, parentId? }` |
| PATCH | `.../discussions/:topicId/replies/:replyId` | same | `{ body }` |
| DELETE | `.../discussions/:topicId/replies/:replyId` | same | 204; soft delete when answered |
| GET | `/courses/:courseId/discussions/settings` | - | `{ studentsCanCreateTopics }` |
| PUT | `/courses/:courseId/discussions/settings` | - | teachers and admins |

### Response shapes

Topic summary (list): `id, courseId, title, isPinned, isLocked, isPublished, requireInitialPost, author, isMine, canEdit, lastReplyAt, editedAt, createdAt, updatedAt, replyCount, unreadCount, isRead`.

Reply: `id, parentId, body, isDeleted, author, isMine, canEdit, isNew, editedAt, createdAt, replies`.

`author` is `{ firstName, lastName, avatarUrl, isStaff }` or null. No email or internal id of another author is ever sent; `isMine` and `canEdit` are computed for the caller so clients (web and mobile) need no ids to decide what to show.

## Module items

A topic can be linked from a module: `POST /courses/:courseId/modules/:moduleId/items` with `{ itemType: 'discussion', discussionTopicId }` (the topic must belong to the course, else 404). `course.module_item.discussion_topic_id` references the topic `ON DELETE CASCADE`, so deleting a topic removes its items. The item's wire shape carries `discussionTopicId` (null for other types) and falls back to the topic title. Students only see the item while the topic is published (`ModuleService.visibleToStudent`). Web links it to `/dashboard/courses/:courseId/discussions/:topicId` (staff) and `/portal/courses/:courseId/discussions/:topicId` (students).

## Notifications

`DiscussionService` calls `CourseNotificationService` (injected `@Optional()`, fire and forget, never blocks the request):

- **Topic published** (created published - including a student's topic - or switched from draft to published): `discussionTopicPublished` writes a `discussion_topic` notice for every active enrolled student except the author, once per student per topic (partial unique index), and pushes.
- **Reply posted**: `discussionReplied` tells the topic author and everyone who has posted in the topic, minus the replier. Students actively enrolled get a `discussion_reply` notice - **coalesced**: at most one unread notice per (recipient, topic), whose title, body (`<name>: <preview>`) and `created_at` are refreshed by each new reply - plus a push. Course staff among them get the push only (they have no in-app list).

Push `data` is `{ type: 'course.discussion', courseId, topicId }`. See [Calendar and Course Notifications](./calendar-notifications.md).

## Not yet

- An in-app notification list for staff.
