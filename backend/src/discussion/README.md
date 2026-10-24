# Discussions (`src/discussion`)

Course discussion forums. A course has topics (a title and a Markdown body) and replies threaded one level deep. Any staff member of the course can read, start topics and reply; teachers and admins also moderate (edit or delete anyone's post, pin, lock, publish, change the course's discussion settings). Students take part through the student portal: they read published topics, reply, and start topics when the course allows it. Everyone may edit and delete their own posts. An archived course stays readable but takes no new posts, apart from staff cleaning up. The module also tracks per-user read state (for unread counts and "new" markers) and tells students about new topics and replies through the course notification service.

## What it provides

### HTTP routes

Staff side, `DiscussionController`, `AuthGuard` plus a course-role check (`CourseAccessService.require` with `STAFF_ROLES`: admin, teacher or TA). A caller with no role in the course gets `404`.

| Method | Path | Who | What it does |
|--------|------|-----|--------------|
| GET | `/api/courses/:courseId/discussions` | Course staff | Topic list (pinned first, then latest activity) with `replyCount`, `unreadCount`, `isRead`, plus `studentsCanCreateTopics` and `canCreateTopics`. Includes unpublished topics. |
| GET | `/api/courses/:courseId/discussions/settings` | Course staff | `{ studentsCanCreateTopics }` (default `false`). |
| PUT | `/api/courses/:courseId/discussions/settings` | Teacher / admin | Set `studentsCanCreateTopics`. |
| POST | `/api/courses/:courseId/discussions` | Course staff | Start a topic; staff may set pinned, locked, published (default true) and require-initial-post. |
| GET | `/api/courses/:courseId/discussions/:topicId` | Course staff | The topic with its threaded replies; marks it read for the caller. |
| PATCH | `/api/courses/:courseId/discussions/:topicId` | Author or teacher / admin | Edit title/body and (staff only) the topic flags. Publishing a draft announces it to students. |
| DELETE | `/api/courses/:courseId/discussions/:topicId` | Author or teacher / admin | Delete the topic and its replies (`204`). |
| POST | `/api/courses/:courseId/discussions/:topicId/replies` | Course staff | Reply (optionally to `parentId`). Locked topics accept replies only from moderators. |
| PATCH | `/api/courses/:courseId/discussions/:topicId/replies/:replyId` | Author or teacher / admin | Edit a reply. |
| DELETE | `/api/courses/:courseId/discussions/:topicId/replies/:replyId` | Author or teacher / admin | Delete a reply (`204`); see deletion rules below. |

Student side, `PortalDiscussionController`, `AuthGuard` + `StudentGuard` plus `CourseAccessService.requireStudent` (enrolment not dropped; course published, or archived for reading; never a template):

| Method | Path | What it does |
|--------|------|--------------|
| GET | `/api/portal/me/courses/:courseId/discussions` | Published topics only, with the caller's counts. |
| POST | `/api/portal/me/courses/:courseId/discussions` | Start a topic, only when `studentsCanCreateTopics` is on. Moderation flags are ignored; the topic is published. |
| GET | `/api/portal/me/courses/:courseId/discussions/:topicId` | A published topic with replies. If the topic requires an initial post and the student has not posted, replies are withheld (`mustPostFirst: true`) and it is not marked read. |
| PATCH | `/api/portal/me/courses/:courseId/discussions/:topicId` | Edit the student's own topic (title and body only; not when locked or archived). |
| DELETE | `/api/portal/me/courses/:courseId/discussions/:topicId` | Delete the student's own topic, only while nobody else has replied (`409` otherwise). |
| POST | `/api/portal/me/courses/:courseId/discussions/:topicId/replies` | Reply. |
| PATCH | `/api/portal/me/courses/:courseId/discussions/:topicId/replies/:replyId` | Edit the student's own reply. |
| DELETE | `/api/portal/me/courses/:courseId/discussions/:topicId/replies/:replyId` | Delete the student's own reply. |

All path ids are checked with `ParseUUIDPipe`.

Behaviour worth knowing:

- Threads are one level deep: answering a nested reply attaches the new reply to the same top-level reply.
- Deleting a reply that has answers blanks it (`isDeleted`, empty body, no author) so the answers keep their place; deleting the last answer under such a placeholder removes the placeholder too. A deleted post cannot be replied to, edited or deleted again.
- A draft topic does not exist for students (`404`).
- Authors are exposed only as first name, last name, avatar and `isStaff`; no email or internal ids of other users.

### Services / exports

The module exports nothing. `DiscussionService` is used by its two controllers:

- `forStaff(userId, courseId)` / `forStudent(userId, studentId, courseId)` - build a `DiscussionCtx` (`course`, `userId`, `role` of `admin` / `teacher` / `ta` / `student`).
- `getSettings`, `updateSettings`, `list`, `get`, `create`, `update`, `remove`, `reply`, `updateReply`, `removeReply`.

Per-topic reply and unread counts come from one raw SQL query over `course.discussion_reply` left-joined to `course.discussion_read`.

## Used by

- `src/app.module.ts` imports `DiscussionModule`.
- Web staff: `frontend/app/dashboard/courses/[courseId]/discussions/page.tsx` and `.../discussions/[topicId]/page.tsx`; the modules editor links topics (`frontend/app/dashboard/courses/[courseId]/modules/_components/AddItemDialog.tsx`, `ModuleItemRow.tsx`).
- Web student: `frontend/app/portal/courses/[courseId]/discussions/page.tsx` and `.../[topicId]/page.tsx`, `frontend/app/portal/courses/[courseId]/modules/page.tsx`.
- Shared web components: `frontend/components/discussions/` (`TopicList`, `TopicView`, `TopicEditorDialog`) and `frontend/lib/courses/discussions.ts`.
- Mobile: `mobile/app/teaching/[courseId]/index.tsx` and `mobile/app/teaching/[courseId]/discussion/[topicId].tsx` (staff), `mobile/app/course/[courseId]/index.tsx` and `mobile/app/course/[courseId]/discussion/[topicId].tsx` (student), `mobile/src/features/discussions/TopicList.tsx`, `mobile/src/lib/course.ts`.
- Scripts: `backend/scripts/smoke.ts` (end-to-end checks), `backend/scripts/seed-demo.ts` (demo topics).

## Depends on

- `PrismaService` (global).
- `CourseAccessService`, `STAFF_ROLES`, `MANAGE_ROLES` from the global `CourseAccessModule` (`src/course/access/`).
- `CourseNotificationService` (global, injected as `@Optional()`) - `discussionTopicPublished` when a topic is created published or later published, `discussionReplied` after each reply. Both are fire and forget.
- `StudentPortalModule` (imported for `StudentGuard`).
- `isoDate` from `src/common/db-values.ts`.

## Data

`prisma/schema/discussion.prisma` (Postgres schema `course`):

- `course.discussion_topic` - read/write.
- `course.discussion_reply` - read/write.
- `course.discussion_read` - read/write (per-user `last_read_at`).
- `course.discussion_setting` - read/write (`students_can_create_topics`).

Course and enrolment rows are read through `CourseAccessService`.

## Configuration

None.

## Files

| File | Purpose |
|------|---------|
| `discussion.module.ts` | Module; imports `StudentPortalModule`, registers both controllers and the service. |
| `discussion.controller.ts` | Staff routes under `/courses/:courseId/discussions`. |
| `portal-discussion.controller.ts` | Student routes under `/portal/me/courses/:courseId/discussions`. |
| `discussion.service.ts` | All rules: permissions, threading, read state, deletion, notices. |
| `dto/discussion.dto.ts` | Request DTOs. See [dto/README.md](dto/README.md). |
| `discussion.service.test.ts` | Unit tests with a mocked Prisma client and access service. |

## Tests

```bash
cd backend && bun test src/discussion
```

Covered: who may edit whose posts (students, TAs, teachers), blanking versus removing replies and cleaning up placeholders, one-level threading, locked topics, archived courses, post-first topics, thread shape, student topic creation gated by the setting, students not changing topic flags or deleting answered topics, draft topics hidden from students, replying to a deleted post, and the notice calls (reply notices, announcing a topic only when it becomes published).

## See also

- [Discussions backend doc](../../../docs/content/backend/discussion.md)
- [course README](../course/README.md), [course/access README](../course/access/README.md), [course-notification README](../course-notification/README.md)
