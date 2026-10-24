---
sidebar_label: Home
sidebar_position: 0
---

# GradeBook

A school management platform: rosters, attendance, classwork, marks and report cards, in one place. Teachers run their classes, students see their own record, and the term grade is calculated from the work rather than typed in at the end.

It runs as a web app and a mobile app against a shared API, and any educator can create a school and start using it — it is not tied to a particular institution.

## Start here

**[Using GradeBook →](./guide/overview.md)**
For the people who use it: administrators, teachers and students. Signing in, setting up a school year, taking attendance, setting and marking work, and producing report cards. No technical knowledge assumed.

**[Developer guide →](./developer-guide.md)**
For the people who build it. Clone to running locally, the variables, and each of the four deploy targets.

**[Changelog →](./changelog/overview.md)**
What changed and why, newest first — including the reasoning behind the decisions, not just the diffs.

## What it does

| | |
| --- | --- |
| **Classes and rosters** | Academic years, terms, classes, enrolment, and subjects with the teachers who take them |
| **Attendance** | A register per class per day, visible to the student immediately and counted on their report card |
| **Work** | Quizzes marked automatically, and assignments handed in as files or text |
| **Grading** | Weighted groups configured per class, with marks flowing straight into the term grade |
| **Reports** | Live grades, class statistics and rankings, and report card PDFs |
| **Students** | A portal showing one student their own work, grades, attendance and reports — and nothing about anyone else |
| **Files and messaging** | Direct-to-storage uploads, sharing, direct messages and school announcements |

## How it is built

| Layer | |
| --- | --- |
| Frontend | Next.js 16, React 19, Tailwind, shadcn/ui |
| Backend | NestJS 12 on Fastify |
| Mobile | Expo / React Native |
| Database | PostgreSQL via Prisma; access enforced in the API |
| Auth | Passwordless, an emailed one-time code |
| Monorepo | Turborepo on Bun |

Two ideas shape most of the code. **Marks are calculated, never stored** — correct a mark and every average, report and ranking downstream of it changes with it. And **access is decided in the API**: application code authorises every read and write against the caller's school, role and classes before it touches the database.

The [backend overview](./backend/overview.md) maps the modules and routes; the schema is in `backend/prisma/schema`.
