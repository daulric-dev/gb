# GradeBook (gb)

A course-based learning platform for schools, in the spirit of Canvas and Moodle. Teachers create courses and build them out of modules, pages, assignments and quizzes; students do their work, check in to class and follow their grades on the web or in the mobile app. Built by [daulric](https://daulric.dev).

GradeBook is not affiliated with any specific school - any educator can sign up, create a school, and start running courses.

## Features

**For teachers**

- **Courses** - create a course, publish it when it's ready, archive it at the end of term. Each course has its own Home, Modules, Assignments, Pages, Announcements, People, Attendance, Grades and Settings.
- **Modules and pages** - organise a course into modules of pages, assignments, files, links and headers; drag to reorder; publish module by module. Pages are written in Markdown.
- **Assignments and quizzes** - file and text submissions, auto-scored quizzes (multiple choice, true/false, short answer) with attempt limits, and offline work marked on paper.
- **Gradebook** - weighted assignment groups (or plain points), excused marks, omit-from-total, letter grades from the school's grade scale, and CSV export.
- **Attendance with self check-in** - open a check-in window and students are notified on their phones. They check in by scanning a rotating QR code or typing a 4-digit room code, optionally within a set distance of the room. Anyone who hasn't checked in is marked absent when it closes.
- **People** - add co-teachers and TAs, enrol students from the school roster, or hand out a course join code.

**For students**

- **Portal and mobile app** - course cards with current grades, a to-do list across courses, modules and pages, assignment and quiz submission, per-course and overall grades with feedback, and attendance history.
- **Check in** - from a push notification, the in-app QR scanner, the phone camera, or the web portal banner.

**For schools**

- **Schools as tenants** - academic years and terms, staff roles and custom permissions, school-wide announcements, chat, and a file manager with sharing.
- **Passwordless sign-in** - email one-time codes; students link their account to the school roster with a join code.

## Tech Stack

| Layer                        | Technology                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------- |
| **Web**                | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui (Base UI), Preact Signals        |
| **Mobile**             | Expo (SDK 57), expo-router, expo-notifications, expo-camera                      |
| **Backend**            | NestJS 12, Fastify, Swagger                                                      |
| **Database**           | PostgreSQL with Prisma 7 (Prisma Migrate)                                        |
| **File storage**       | Any S3-compatible store (SeaweedFS in development)                               |
| **Email**              | Any SMTP server (Mailpit in development)                                         |
| **Realtime and cache** | Redis (pub/sub, cache, BullMQ queue); in-memory fallback for single-instance dev |
| **Push**               | Expo push service                                                                |
| **Auth**               | Own passwordless email codes and server sessions; Google, Microsoft and SAML SSO |
| **Monorepo**           | Turborepo, Bun                                                                   |
| **CI/CD**              | GitHub Actions (with CI Gate required status check)                              |

## Project Structure

```
gb/
├── backend/                 # NestJS API (all routes under /api)
│   ├── prisma/              # Prisma schema (one file per database schema) and migrations
│   ├── scripts/             # seed-demo, smoke, student-flow-check, one-off data/storage copy
│   └── src/
│       ├── course/          # Courses, people, join codes, modules, pages, course access
│       ├── grading/         # Activities, quizzes, submissions, assignment groups, gradebook
│       ├── attendance/      # Sessions, self check-in, QR tokens, live streams
│       ├── notifications/   # Push device registration and Expo push
│       ├── student-portal/  # Student-facing endpoints (/portal/me)
│       ├── announcement/    # School-wide and course announcements
│       ├── auth/  account/  # Email-code sign-in, sessions, guards, profile
│       ├── sso/             # OIDC (Google, Microsoft) and SAML sign-in
│       ├── permission/      # Roles and permission catalog
│       ├── school/  student/  student-account/  academic-year/  term/  grade-scale/
│       ├── chat/  file-manager/  dashboard/  images/
│       └── prisma/  storage/  mail/  cache/  realtime/  queue/  versioning/  throttle/
├── frontend/                # Next.js web app
│   └── app/
│       ├── dashboard/       # Staff: courses, students, staff, calendar, files, chat, settings
│       ├── portal/          # Students: courses, grades, to-do, attendance
│       ├── scan/            # Public landing page for the attendance QR code
│       └── login/  onboard/  schools/  privacy/  terms/
├── mobile/                  # Expo app for students and teachers
├── docs/                    # Documentation site
├── infrastructure/          # Production Docker Compose, nginx, dev S3 config
└── .github/                 # CI workflows and scripts
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) 1.3+
- [Docker](https://www.docker.com) (for local Postgres, Redis, S3 and Mailpit)

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment variables

**Backend** - copy `backend/.env.example` to `backend/.env`. Its defaults match `docker-compose.dev.yml`:

```bash
cp backend/.env.example backend/.env
```

```env
DATABASE_URL=postgresql://gradebook:gradebook@127.0.0.1:5432/gradebook
S3_ENDPOINT=http://127.0.0.1:8333
SMTP_URL=smtp://127.0.0.1:1025
FRONTEND_URL=http://localhost:3000
PORT=3001
ALLOW_DEV_LOGIN=true
```

**Frontend** - create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

**Mobile** - nothing needed in development; the app finds the API through the Expo dev server.

### 3. Start the local services and create the schema

```bash
bun run preload    # Postgres, Redis, S3 (SeaweedFS) and Mailpit via docker-compose.dev.yml, then `prisma migrate deploy`, then the Stripe webhook listener (only with billing on and a sk_test_ key)
```

`bun run postload` stops them. `bun run db:setup` applies pending migrations on its own. Sign-in emails land in Mailpit at http://127.0.0.1:8025.

See [`docs/content/environment-variables.md`](docs/content/environment-variables.md) for every variable, and [`docs/content/developer-guide.md`](docs/content/developer-guide.md) for the full path from clone to deployed.

### 4. Run the dev servers

```bash
bun run dev
```

This starts the web app (3000), the API (3001), the docs (3002) and Expo's Metro bundler in parallel. To run fewer:

```bash
bun run dev:frontend   # Next.js on :3000
bun run dev:backend    # NestJS on :3001
bun run dev:mobile     # Expo / Metro
bun run dev:docs       # Docs site on :3002
```

### 5. Load demo data (optional)

With the API running:

```bash
bun run seed:demo              # creates "Riverside Academy" with courses, work, grades and attendance
bun run seed:demo --fresh      # replace it
bun run seed:demo otp <email>  # print a sign-in code without sending email
```

| Account                                        | Role                                                            |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `admin@demo.test`                            | School admin, sees every course                                 |
| `teacher@demo.test`                          | Teaches Biology 101 and World History (draft)                   |
| `teacher2@demo.test`                         | Teaches Algebra I and Creative Writing (archived)               |
| `ta@demo.test`                               | TA in Biology 101                                               |
| `student@demo.test`                          | Student with marked work, a quiz attempt and attendance history |
| `student2@demo.test`, `student3@demo.test` | More students                                                   |

Every sign-in email is also in Mailpit (http://127.0.0.1:8025); the `otp` command skips email altogether.

### Mobile push and camera

Push notifications, the QR scanner and location checks need a development build on a physical device:

1. Run `eas init` in `mobile/` to set the Expo project ID.
2. Run `npx expo prebuild -p ios` (the `ios/` project is committed), then `expo run:ios` or `eas build --profile development`. Do the same for Android, with Firebase credentials for push.

Expo Go and simulators can't receive push notifications.

## API Documentation

When the backend is running, Swagger docs are at:

```
http://localhost:3001/docs
```

Deploying is covered in [`docs/content/platform-migration.md`](docs/content/platform-migration.md); single sign-on setup in [`docs/content/sso.md`](docs/content/sso.md); what changed in the [2026-10-21 changelog](docs/content/changelog/overview.md).

## Scripts

All tasks are orchestrated by [Turborepo](https://turbo.build) for caching and parallel execution.

| Command                                                                    | Description                           |
| -------------------------------------------------------------------------- | ------------------------------------- |
| `bun run preload` / `postload`                                         | Start (and migrate) / stop local Postgres, Redis, S3, Mailpit and the Stripe webhook listener |
| `bun run dev`                                                            | Start every workspace in development  |
| `bun run dev:frontend` / `dev:backend` / `dev:mobile` / `dev:docs` | Start one workspace                   |
| `bun run build`                                                          | Build all projects (cached)           |
| `bun run build:frontend` / `build:backend`                             | Build one project                     |
| `bun run lint`                                                           | Lint all projects                     |
| `bun run test`                                                           | Run all tests                         |
| `bun run test:frontend` / `test:backend`                               | Run one project's tests               |
| `bun run preview`                                                        | Run in production mode                |
| `bun run db:setup` / `db:deploy`                                       | Apply pending Prisma migrations       |
| `bun run db:migrate --name <change>`                                     | Create and apply a migration from `.prisma` edits |
| `bun run db:pull` / `db:studio`                                        | Introspect the database / open Prisma Studio |
| `bun run seed:demo` / `smoke`                                          | Load demo data / end-to-end API check (API running) |

You can also use `turbo` directly:

```bash
turbo run build --filter=frontend    # build a specific package
turbo run lint test --parallel       # run multiple tasks
turbo run build --dry-run            # see what would run
```

## Contributing

GradeBook is **source-available** - the code is public to encourage security review and bug discovery. If you find a vulnerability or bug, please report it to **security@daulric.dev**. Do not open a public issue for security findings.

See [SECURITY.md](SECURITY.md) for full details on scope, expectations, and what to include in a report.

## License

Source-available, proprietary - see [LICENSE.md](LICENSE.md) for details. You may view and review the code, but use, modification, and redistribution are not permitted without authorization.
