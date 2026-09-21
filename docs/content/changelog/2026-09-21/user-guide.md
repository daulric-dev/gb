---
sidebar_label: 2026-09-21 · User guide and home page
sidebar_position: 6
---

# 2026-09-21 - A user guide, a developer guide, and a home page

The docs site covered how the system is built and nothing about how it is used. Three additions close that, aimed at three different readers.

## User guide

A **User Guide** section, written for administrators, teachers and students rather than developers, and assuming nothing technical:

| Page | Covers |
| --- | --- |
| Overview | What each role can do, and how school → year → term → class → work → marks stack up |
| Accounts and signing in | Emailed codes, first sign-in, creating vs joining a school, the student join code |
| Setting up your school | Calendar, subjects, grade scales, staff, roles, roster, duplicate merging |
| Classes and attendance | Enrolment, subject teachers, the register |
| Work and grading | Grading schemes, quizzes, assignments, marking, exclusions, how a term grade is derived |
| Reports and report cards | Live grades vs class report vs PDF, and what to check before generating |
| The student portal | Work, grades, attendance, reports |
| Files, messages and announcements | Uploads, direct messages, notices, settings, the mobile app |

Written from the running product rather than from the code, so it uses the words on the buttons - "Do not count", "Hand in" - and not the names of the tables behind them.

It leads with the things people actually get stuck on:

- **Setup order matters.** Each step depends on the one above it, and most "it will not let me" reports are a missed step further up. There is a checklist.
- **Uploading is not handing in.** The student flow is two steps deliberately, so a file can be attached now and submitted later; the guide says so rather than leaving it to be discovered.
- **Excluding a mark is not the same as a zero.** A zero is a real mark that drags an average down. Both levels - a whole activity, one student's mark - are explained, with when to use which.
- **The join code cannot know who someone is**, so duplicate student records are expected rather than a fault, and merging keeps the record that holds the history.
- **Deleting your account** removes a login, not the school's records - and if you are the only administrator, that needs handling first.

Two claims were corrected by checking rather than assuming. A draft said a student could be in one class per year and that enrolling elsewhere moved them; the constraint is on `(student_id, student_group_id)`, so a student **can** be in several classes and only the same class twice is refused. The 10MB cap, the accepted file types, the three attendance statuses, and that students only ever see `published` and `sent_to_ministry` reports were all verified against the code before being written down.

## Developer guide

A **Developer guide** covering the path the reference docs never did: clone, run locally against a local Supabase, the variables, and each of the four deploy targets. It also records three things that were previously only discoverable by reading the code:

- `bun run dev` starts **all four** workspaces, not two. The README said two.
- Swagger is at `/docs`, not `/api/docs` - it is mounted before `setGlobalPrefix('api')` - and it is not served in production.
- **`infrastructure/docker-compose.yml` does not run the application.** It starts Redis only. Its `x-app` anchors are defined and never used, and the nginx config load-balances to `app1`/`app2`/`app3`, which nothing defines. The image is the deliverable; the orchestration is not written.

`backend/.env.example` was missing entirely - the one workspace holding every secret had no template. Writing it exposed why: `.gitignore` had `*.env*`, so `backend/.env.example` and `mobile/.env.example` were both uncommittable, which is why `infrastructure/env.example` has no leading dot. A negation rule now allows the examples through while every real `.env` stays ignored.

## Home page

`/` used to fall through to the implementation guide - a 1,100-line reference, which is a steep first page. It now renders `content/home.md`: what the platform is, then three routes in (user guide, developer guide, changelog), what it does, and what it is built with.

The page is deliberately **not** a sidebar entry. The brand link in the header is how you return to it, and listing it twice in a nav that is otherwise all reference material adds noise.

## Verified

Every page renders, all internal links resolve in both directions, the sidebar orders the section correctly, the brand link returns home as a client transition, `/home` and `/` render the same page, nothing overflows at phone width, and there are no console errors.
