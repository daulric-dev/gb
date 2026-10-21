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
| **Database**           | Supabase (PostgreSQL) with Row-Level Security                                    |
| **Realtime and cache** | Redis (pub/sub, cache, BullMQ queue); in-memory fallback for single-instance dev |
| **Push**               | Expo push service                                                                |
| **Auth**               | Passwordless OTP via email                                                       |
| **Monorepo**           | Turborepo, Bun                                                                   |
| **CI/CD**              | GitHub Actions (with CI Gate required status check)                              |

## Project Structure

```
gb/
├── backend/                 # NestJS API (all routes under /api)
│   ├── scripts/             # seed-demo, rls-check, student-flow-check, type generation
│   └── src/
│       ├── course/          # Courses, people, join codes, modules, pages, course access
│       ├── grading/         # Activities, quizzes, submissions, assignment groups, gradebook
│       ├── attendance/      # Sessions, self check-in, QR tokens, live streams
│       ├── notifications/   # Push device registration and Expo push
│       ├── student-portal/  # Student-facing endpoints (/portal/me)
│       ├── announcement/    # School-wide and course announcements
│       ├── auth/            # OTP sign-in, guards, profile
│       ├── permission/      # Roles and permission catalog
│       ├── school/  student/  student-account/  academic-year/  term/  grade-scale/
│       ├── chat/  file-manager/  dashboard/  images/
│       └── cache/  realtime/  queue/  supabase/  versioning/  throttle/
├── frontend/                # Next.js web app
│   └── app/
│       ├── dashboard/       # Staff: courses, students, staff, calendar, files, chat, settings
│       ├── portal/          # Students: courses, grades, to-do, attendance
│       ├── scan/            # Public landing page for the attendance QR code
│       └── login/  onboard/  schools/  privacy/  terms/
├── mobile/                  # Expo app for students and teachers
├── supabase/                # Migrations, config, edge functions
├── docs/                    # Documentation site
├── infrastructure/          # Production Docker Compose, nginx
└── .github/                 # CI workflows and scripts
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) 1.3+
- [Docker](https://www.docker.com) (for local Supabase and Redis)

### 1. Install dependencies

```bash
bun install
```

### 2. Start Supabase and Redis

```bash
bun run preload    # Redis via docker-compose.dev.yml + local Supabase
```

`bun run postload` stops both. Supabase applies every migration in `supabase/migrations` on first start.

### 3. Configure environment variables

**Backend** - copy `backend/.env.example` to `backend/.env`. For a local stack, `bunx supabase status` prints the keys:

```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<service_role JWT>
SUPABASE_PUSHABLE_KEY=<anon key>
SUPABASE_JWT_SECRET=<JWT secret>
FRONTEND_URL=http://localhost:3000
PORT=3001
USE_REDIS=true
REDIS_URL=redis://localhost:6379
```

**Frontend** - create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

**Mobile** - nothing needed in development; the app finds the API through the Expo dev server.

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
cd backend
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

Local Supabase sends at most two emails an hour, so sign in with the `otp` command rather than waiting for an email.

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

Upgrading an existing deployment to courses - migrations, Supabase settings, environment variables, mobile rebuild - is covered in [`docs/content/upgrading-to-courses.md`](docs/content/upgrading-to-courses.md); single sign-on setup in [`docs/content/sso.md`](docs/content/sso.md); what changed in the [2026-10-21 changelog](docs/content/changelog/overview.md).

## Scripts

All tasks are orchestrated by [Turborepo](https://turbo.build) for caching and parallel execution.

| Command                                                                    | Description                           |
| -------------------------------------------------------------------------- | ------------------------------------- |
| `bun run preload` / `postload`                                         | Start / stop local Redis and Supabase |
| `bun run dev`                                                            | Start every workspace in development  |
| `bun run dev:frontend` / `dev:backend` / `dev:mobile` / `dev:docs` | Start one workspace                   |
| `bun run build`                                                          | Build all projects (cached)           |
| `bun run build:frontend` / `build:backend`                             | Build one project                     |
| `bun run lint`                                                           | Lint all projects                     |
| `bun run test`                                                           | Run all tests                         |
| `bun run test:frontend` / `test:backend`                               | Run one project's tests               |
| `bun run preview`                                                        | Run in production mode                |
| `bun run db:start` / `db:stop`                                         | Start / stop local Supabase only      |
| `bun run db:types`                                                       | Generate Supabase database types      |
| `bun run db:diff` / `db:pull`                                          | Diff or pull the database schema      |

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
