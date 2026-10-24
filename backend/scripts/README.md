# Backend scripts (`backend/scripts`)

Developer scripts that run against a **local** stack. Each one talks to the running API over HTTP (as real users, through the cookie session) and also opens its own Prisma client on `DATABASE_URL` for fixtures and clean-up. None of them is part of the build or the test suite, and none should be pointed at a shared or production database.

## Prerequisites (all three)

1. The dev services are up and migrated: `bun run preload` from the repo root (Postgres, Redis, S3, Mailpit, then `prisma migrate deploy`).
2. `backend/.env` exists (copy `backend/.env.example`) with `DATABASE_URL` and **`ALLOW_DEV_LOGIN=true`**. The scripts sign in through the dev-only `POST /api/auth/dev/code`, which returns a sign-in code instead of mailing it; it answers 404 when `ALLOW_DEV_LOGIN` is off or `NODE_ENV=production`.
3. The API is running: `bun run start:dev` in `backend/` (or `bun run dev:backend` from the root).

Bun loads `backend/.env` automatically when the scripts run from `backend/` (the root `package.json` scripts use `bun run --cwd backend ...`). All three read:

| Variable | Default | Use |
| --- | --- | --- |
| `API_URL` | `http://127.0.0.1:3001` | API origin; `/api` is appended. |
| `DATABASE_URL` | - | Direct database access for fixtures and clean-up. |

## `seed-demo.ts` - demo school

```bash
bun run seed:demo              # create the demo school (fails if it already exists)
bun run seed:demo --fresh      # delete the demo school and every @demo.test account first, then create it
bun run seed:demo otp <email>  # print a sign-in code for an account (no mail)
```

Creates **Riverside Academy**. Accounts, profiles, school membership and the roster go straight into the database (what onboarding would have done). Everything course-shaped then goes through the real API as the teacher or student who would do it - a grade scale, courses with staff and students, assignment groups, modules, pages, an uploaded file, activities and quiz questions, rubrics, discussions and replies, submissions, quiz attempts and marks, the course join code, course and school announcements - so seeding also exercises those endpoints. Two verified email domains and three past weeks of Biology attendance are written directly (there is no DNS for `demo.test`, and the API can only open a session now).

Demo accounts (sign in at `http://localhost:3000/login`, read the code from Mailpit at `http://127.0.0.1:8025` or use `bun run seed:demo otp <email>`):

| Email | Name | Role |
| --- | --- | --- |
| `admin@demo.test` | Grace Okafor | School admin, sees every course |
| `teacher@demo.test` | Maya Patel | Teaches Biology 101 and World History (draft) |
| `teacher2@demo.test` | Leo Brooks | Teaches Algebra I and Creative Writing (archived) |
| `ta@demo.test` | Ana Ruiz | TA in Biology 101 |
| `student@demo.test` | Jordan Lee | Student in Biology, Algebra, Creative Writing; quiz taken, lab marked |
| `student2@demo.test` | Priya Shah | Student; lab handed in and waiting to be marked; write-up marked by rubric |
| `student3@demo.test` | Marcus Bell | Student |

Plus nine roster-only students without logins. Email domains: anyone signing in as `<name>@students.demo.test` joins Riverside as a student; `<name>@staff.demo.test` asks the admin to join as staff (set `ALLOW_UNVERIFIED_EMAIL_DOMAINS=true` locally if you add your own made-up domains). The script prints the Biology 101 join code at the end.

## `smoke.ts` - end-to-end check

```bash
bun run seed:demo --fresh   # once, with the API running
bun run smoke
```

Signs in as `teacher`, `ta`, `admin`, `student` and `student2` from the demo school and walks the main flows, printing `PASS` / `FAIL` per check and exiting non-zero on any failure: profile and school structure (date formats, permissions), courses and course files through the portal, the gradebook, grading extras (CSV import, drop lowest, rubrics), the student portal, the calendar and new-work notices, attendance (code and QR), email domains and SSO discovery, announcements and chat, discussions, course copy and templates, and billing. With `BILLING_ENABLED=true` it runs the billing flow and then restores the school's subscription and removes the invoices it created (and, with `USE_REDIS=true`, drops the cached `billing:ent:<schoolId>` entitlement); with billing off it checks that every `/billing` and `/platform` route is 404.

It cleans up what it creates. Work that has been marked cannot be deleted through the API by design, so that part of the clean-up uses `DATABASE_URL` directly. It needs the demo school from `seed:demo`.

## `student-flow-check.ts` - student account journey

```bash
bun run student:check
```

Needs the API running with `ALLOW_DEV_LOGIN=true`; it does **not** need the demo school. It creates its own fixtures directly in the database: a school, a staff admin (`http-staff-<timestamp>@t.test`) with a `school_management` row, a year and term, two roster students (`Sam Self`, who already has a mark of 77, and a classmate with 12), a published course with a join code, the teacher and the classmate's enrolment, an activity with both submissions, a published and a draft page, and a published module linking both. Then it drives the HTTP API, printing `PASS` / `FAIL` per check and exiting non-zero on any failure:

1. **School join code** - the staff admin signs in, sees no live code (`GET /api/schools/join-code`), issues one (`POST`, the only response that shows it) and checks the status never shows it.
2. **Student sign-in and onboarding** - a new student account signs in (reported as `staff` and not onboarded), is refused `/api/portal/me`, onboards as a student (`PATCH /api/auth/onboard`; `@t.test` is no school's email domain, so there is no auto-join), cannot re-onboard as staff, and is still refused the portal.
3. **Redeeming the code** (`POST /api/auth/join-school`) - a wrong code and a wrong-length code get the same 400; the real code (lower case, no dashes) creates a **new** student record and opens the portal on it; joining again is a 409; a second student (`Nia New`) can redeem the same code, because codes are not consumed.
4. **Linking to the roster record** - staff see the new record as a duplicate of `Sam Self` (`GET /api/students/duplicates`; `Nia New` is not listed), a student cannot merge (403), staff merge it (`POST /api/students/duplicates/:joinedId/merge/:existingId`), the roster record now carries the login, the join-time record is gone, and merging into a record that already has an account is a 409. `/api/portal/me` now returns the roster record.
5. **Portal** - no courses yet, an unjoined course is a 404, a wrong course code is a 404, joining by code works and the card has no join code, the card lists the teacher and the caller's own grade (77), the grades page shows only the caller's score, modules show published items only, the published page reads and the draft is a 404, course announcements respond.
6. **Staff API refused** - `/students`, `/dashboard/summary`, `/schools/members`, `/permissions/catalog` and `/schools/join-code` are 403 for the student; `/permissions/me` reports a student with no permissions.
7. **Revoking** - staff revoke the code (204), the status shows no live code, and redeeming it is now a 400.

Billing: the fixture school has no subscription, which the API treats as writable, so the script passes with `BILLING_ENABLED` on or off.

**Clean-up** runs in a `finally`, so it happens even when a check fails or the script throws: it deletes the school (cascading to its years, terms, courses and their content, students, join codes, memberships and billing rows), the three accounts by email (cascading to profiles, sessions and identities) and their sign-in codes. The last check compares the `school`, `app_user` and `student` row counts with those taken before the run. Emails carry a timestamp, so runs never collide.

## See also

- [docs/content/developer-guide.md](../../docs/content/developer-guide.md) - setup and everyday commands.
- [../README.md](../README.md)
