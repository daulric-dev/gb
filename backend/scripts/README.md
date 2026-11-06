# Backend scripts (`backend/scripts`)

Two kinds of script. `seed-demo`, `smoke` and `student-flow-check` are developer scripts that run against a **local** stack: each talks to the running API over HTTP (as real users, through the cookie session) and also opens its own Prisma client on `DATABASE_URL` for fixtures and clean-up; never point them at a shared or production database. `retention-purge`, `erasure-replay` and `reencrypt-secrets` are operational tools that work on the database and object storage directly (no API needed) and are meant for any deployment. None of them is part of the build or the test suite.

## Prerequisites (seed-demo, smoke, student-flow-check)

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

Creates **Riverside Academy**. Accounts, profiles, school membership and the roster go straight into the database (what onboarding would have done), and so does the organisation: if the install has none yet it creates **Riverside Education Trust** (what first-run setup, `POST /api/setup`, would have done), and `admin@demo.test` becomes an organisation admin either way (the row goes with the account on `--fresh`; the organisation stays). Everything course-shaped then goes through the real API as the teacher or student who would do it - a grade scale, courses with staff and students, assignment groups, modules, pages, an uploaded file, activities and quiz questions, rubrics, discussions and replies, submissions, quiz attempts and marks, the course join code, course and school announcements - so seeding also exercises those endpoints. Two verified email domains and three past weeks of Biology attendance are written directly (there is no DNS for `demo.test`, and the API can only open a session now).

Demo accounts (sign in at `http://localhost:3000/login`, read the code from Mailpit at `http://127.0.0.1:8025` or use `bun run seed:demo otp <email>`):

| Email | Name | Role |
| --- | --- | --- |
| `admin@demo.test` | Grace Okafor | School admin (sees every course) and organisation admin |
| `teacher@demo.test` | Maya Patel | Teaches Biology 101 and World History (draft) |
| `teacher2@demo.test` | Leo Brooks | Teaches Algebra I and Creative Writing (archived) |
| `ta@demo.test` | Ana Ruiz | TA in Biology 101 |
| `student@demo.test` | Jordan Lee | Student in Biology, Algebra, Creative Writing; quiz taken, lab marked |
| `student2@demo.test` | Priya Shah | Student; lab handed in and waiting to be marked; write-up marked by rubric |
| `student3@demo.test` | Marcus Bell | Student |

Plus nine roster-only students without logins, inserted directly to fill the class lists (the app itself only creates a student when a signed-up user joins as one). Email domains: anyone signing in as `<name>@students.demo.test` joins Riverside as a student; `<name>@staff.demo.test` asks the admin to join as staff (set `ALLOW_UNVERIFIED_EMAIL_DOMAINS=true` locally if you add your own made-up domains). The script prints the Biology 101 join code at the end.

## `smoke.ts` - end-to-end check

```bash
bun run seed:demo --fresh   # once, with the API running
bun run smoke
```

Signs in as `teacher`, `ta`, `admin`, `student` and `student2` from the demo school and walks the main flows, printing `PASS` / `FAIL` per check and exiting non-zero on any failure: profile and school structure (date formats, permissions), courses and course files through the portal, the gradebook, grading extras (CSV import, drop lowest, rubrics), the student portal, the calendar and new-work notices, attendance (code and QR), email domains and SSO discovery, announcements and chat, discussions, course copy and templates, and the organisation: `GET /setup/status` is public and reports done, a second `POST /setup` is a 409, `admin` is an organisation admin (`is_org_admin` on `/auth/me`) and the teacher and student get 403 on `/organisation`, the overview and the schools list (with the demo school's admin and counts), `POST /schools` and the old `/billing` and `/platform` routes are 404, and a school created with `POST /organisation/schools` gets its system roles and the TA as admin without making the organisation admin a member; appointing the teacher demotes the TA to teacher, an unknown email is a 404, and the school can be deactivated (then deleted straight from the database).

The last section checks GDPR erasure: the teacher deletes a new file and a chat message, the erasure-log entries are checked (ids only, right actor and reason), `retention-purge.ts --retention-days 0 --only <those two ids>` is run (dry run first) and must remove both rows and the stored object with `retention_purge` entries, then a restore is simulated - the two rows put back and their log entries deleted, after waiting for them to reach object storage - and `erasure-replay.ts --since <start of the section>` must remove the rows again from the storage copy and restore the log entries; a second replay must report `0 applied`. Its erasure-log entries stay (the log is append-only).

It cleans up what it creates. Work that has been marked cannot be deleted through the API by design, so that part of the clean-up uses `DATABASE_URL` directly. It needs the demo school from `seed:demo`.

## `student-flow-check.ts` - student account journey

```bash
bun run student:check
```

Needs the API running with `ALLOW_DEV_LOGIN=true`; it does **not** need the demo school. It creates its own fixtures directly in the database: a school, a staff admin (`http-staff-<timestamp>@t.test`) with a `school_management` row, a year and term, one roster student (a classmate with a mark of 12), a published course with a join code, the teacher and the classmate's enrolment, an activity with the classmate's submission, a published and a draft page, and a published module linking both. Then it drives the HTTP API, printing `PASS` / `FAIL` per check and exiting non-zero on any failure:

1. **School join code** - the staff admin signs in, sees no live code (`GET /api/schools/join-code`), issues one (`POST`, the only response that shows it) and checks the status never shows it.
2. **Student sign-in and onboarding** - a new student account signs in (reported as `staff` and not onboarded), is refused `/api/portal/me`, onboards as a student (`PATCH /api/auth/onboard`; `@t.test` is no school's email domain, so there is no auto-join), cannot re-onboard as staff, and is still refused the portal.
3. **Redeeming the code** (`POST /api/auth/join-school`) - a wrong code and a wrong-length code get the same 400; the real code (lower case, no dashes) creates the student record from the profile (`Sam Self`), linked to the login, and opens the portal on it; joining again is a 409; a second student (`Nia New`) can redeem the same code, because codes are not consumed.
4. **Roster** - staff see the joined student in `GET /api/students`, and `POST /api/students` is a 404 (staff cannot create student records). A mark of 77 is then written against the joined record, and `/api/portal/me` returns it.
5. **Portal** - no courses yet, an unjoined course is a 404, a wrong course code is a 404, joining by code works and the card has no join code, the card lists the teacher and the caller's own grade (77), the grades page shows only the caller's score, modules show published items only, the published page reads and the draft is a 404, course announcements respond.
6. **Staff API refused** - `/students`, `/dashboard/summary`, `/schools/members`, `/permissions/catalog` and `/schools/join-code` are 403 for the student; `/permissions/me` reports a student with no permissions.
7. **Revoking** - staff revoke the code (204), the status shows no live code, and redeeming it is now a 400.

**Clean-up** runs in a `finally`, so it happens even when a check fails or the script throws: it deletes the school (cascading to its years, terms, courses and their content, students, join codes and memberships), the three accounts by email (cascading to profiles, sessions and identities) and their sign-in codes. The last check compares the `school`, `app_user` and `student` row counts with those taken before the run. Emails carry a timestamp, so runs never collide.

## `retention-purge.ts` - soft-delete purge, now

```bash
bun run retention:purge --dry-run          # counts only
bun run retention:purge                    # what the API runs daily
bun run retention:purge --retention-days 0 --only <id,id>   # tests: just these rows
```

Builds `RetentionService` without Nest, takes the same advisory lock as the API's scheduler and runs one purge: expired soft-deleted files (objects first), folders, chat messages and discussion replies, old sessions and sign-in codes, erasure-log pruning and export. Needs `DATABASE_URL` and the `S3_*` variables; not the API. Exits 1 if any part failed. See [src/retention](../src/retention/README.md).

## `erasure-replay.ts` - after a backup restore

```bash
bun run erasure:replay --since 2026-10-24T04:00:00Z --dry-run
bun run erasure:replay --since 2026-10-24T04:00:00Z [--source both|db|storage] [--from-file log.jsonl] [--allow-unsigned] [--json]
```

Re-applies every erasure logged since the given time to the current database: entries from `compliance.erasure_log` and its copy in object storage, de-duplicated and applied oldest first, one transaction each. Idempotent. Exits 1 if an entry failed, 2 on bad arguments. Needs `DATABASE_URL`, `S3_*` and the same `AUTH_SECRET` and `DATA_ENCRYPTION_KEY` as the API (signatures). This one **is** meant for production, as part of the restore runbook in [infrastructure/BACKUPS.md](../../infrastructure/BACKUPS.md). See [src/erasure](../src/erasure/README.md).

## `reencrypt-secrets.ts` - before rotating `AUTH_SECRET`

```bash
bun run secrets:reencrypt --dry-run
bun run secrets:reencrypt [--skip-erasure-log] [--json]
```

Moves the stored secrets off `AUTH_SECRET` onto `DATA_ENCRYPTION_KEY`: re-encrypts every `v1` webhook signing secret, webhook header value and school SSO client secret as `v2`, and re-signs the erasure-log copies in object storage that only verify under the `AUTH_SECRET` key (copies that do not verify at all are left alone). Run it with the **current** `AUTH_SECRET` and the new `DATA_ENCRYPTION_KEY` (the API should already be running with it), then rotate `AUTH_SECRET`. Idempotent; a row changed while it runs is left to its new value. Exits 0 when nothing is left on `AUTH_SECRET`, 1 when some values could not be decrypted or verified (they were already unusable: enter them again), 2 on bad arguments or without `DATA_ENCRYPTION_KEY`. Needs `DATABASE_URL` and (unless `--skip-erasure-log`) `S3_*`. Meant for production. See [src/account](../src/account/README.md).

## See also

- [docs/content/developer-guide.md](../../docs/content/developer-guide.md) - setup and everyday commands.
- [../README.md](../README.md)
