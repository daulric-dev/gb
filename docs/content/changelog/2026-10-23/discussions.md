---
sidebar_label: 2026-10-23 · Course discussions
sidebar_position: 2
---

# 2026-10-23 - Course discussions

Courses have a **Discussions** tab on the web for staff and in the student portal: a forum of topics with threaded replies.

## What it does

- Teachers and TAs start topics with a title and a Markdown prompt. Topics can be **pinned**, **locked** (no new replies, except a teacher's), kept as a **draft**, or set to **post before seeing replies** so students answer before reading their classmates.
- Everyone in the course replies, and can answer a reply; threads are one level deep.
- Everyone edits and deletes their own posts. Teachers and admins moderate: edit or delete any post, pin and lock any topic. A deleted reply that has answers stays as *"This post was deleted"*.
- The topic list shows reply counts and how many replies are new since you last opened each topic.
- A per-course switch, **Students can start topics**, lets students open their own threads (off by default).
- Archived courses keep their discussions readable; nobody can post new topics or replies.

Posts show the author's name and avatar, with a **Staff** badge for staff. Emails are never sent to other students.

## Deploying

Migration `20261023140000_discussions` adds four tables in the `course` schema (`discussion_topic`, `discussion_reply`, `discussion_read`, `discussion_setting`). Apply with `bun run db:deploy`. Nothing else to configure.

## API

New routes under `/courses/:courseId/discussions` (staff) and `/portal/me/courses/:courseId/discussions` (students); see [Discussion module](../../backend/discussion.md). Responses are camelCase and include `isMine` / `canEdit`, so the mobile app can build its screens without author ids.

`bun run seed:demo` adds a pinned topic with a short thread to Biology 101, and `bun run smoke` covers posting, threading, permissions and moderation.

## Not yet

Linking a topic from a module, and notifications for new topics and replies.
