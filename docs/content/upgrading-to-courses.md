---
label: Upgrading to Courses
---

# Upgrading to courses

How to take an existing GradeBook deployment (classes, subjects, report cards) to the course-based LMS, and everything that has to be configured along the way. What changed and why is in the [changelog for 2026-10-21](./changelog/overview.md).

> These steps were written for, and applied before, the 2026-10-21 move off Supabase. The migrations listed in step 2 are now part of the Prisma baseline (`backend/prisma/migrations/0_baseline`), and step 4 no longer applies - a deployment upgrading today runs `prisma migrate deploy` and follows [Platform migration](./platform-migration.md) and [Single sign-on](./sso.md) instead.

Work through the sections in order. Steps marked **required** break the app if skipped; the rest switch on optional features.

## 1. Before you start

- **Export report cards.** Report books, their PDFs, class report files and class attendance are **not** carried into courses. Their tables stay in the database untouched until a later cleanup migration, but nothing in the app shows them any more. Download every report PDF you need to keep (objects under `report-books/`) before deploying.
- **Rehearse on a copy of production.** Restore a recent backup into a staging project, run the migrations there, and do the checks in step 3 before touching production.
- **Tell users.** Classes and Subjects disappear from the menu and become Courses; report cards disappear. Mobile users need the new app build for attendance, QR scanning, push and SSO.

## 2. Database migrations (required)

Apply in this order (at the time, with the Supabase CLI's `db push`; they are now part of the Prisma baseline). Each file is its own transaction; the first one must commit before the others because they use the enum values it adds.

| Migration | What it does |
| --- | --- |
| `20261020120000_lms_enums.sql` | Adds activity kind `offline` and file-share principal `course` |
| `20261020120100_lms_courses.sql` | New `course` schema (courses, staff, students, assignment groups, modules, pages); activities, submissions and announcements gain course columns; `submit_quiz` stops writing the old gradebook; term names become free text |
| `20261020120200_lms_backfill.sql` | Copies classes × subjects into courses, with staff, students, grading groups, activities and every mark. Idempotent; deletes nothing |
| `20261021120000_course_attendance.sql` | Attendance sessions and records, push device table |
| `20261021130000_attendance_qr.sql` | QR secret per session, check-in method `qr` |
| `20261021140000_school_email_domains.sql` | School email domains and the join-by-domain function |
| `20261021150000_email_domain_any_audience.sql` | "Students and staff" domains |
| `20261021160000_school_sso.sql` | SSO provider, "require SSO" and Microsoft tenant per domain |

## 3. Check the data migration (required)

The backfill prints one line when it finishes:

```
NOTICE:  lms backfill: N migrated courses, 0 activities without a course, 0 marks not carried to a submission
```

Both zeros matter. Then spot-check a few classes:

```sql
-- every class × subject with a teacher, work or marks became a course
select c.name, c.status, count(cs.*) as students
from course.course c
left join course.course_student cs on cs.course_id = c.id and cs.status = 'active'
where c.legacy_student_group_id is not null
group by c.id order by c.name;

-- a known student's marks survived
select a.title, s.score, s.excused
from grading.submission s join grading.activity a on a.id = s.activity_id
where s.student_id = '<student id>' order by a.title;
```

How the backfill decides things:

- **Courses:** one per (class, subject) with a subject teacher, work set, or a mark recorded. Named "Subject - Class". Courses in the active academic year are `published`; older years are `archived`.
- **Staff:** subject teachers and anyone who set work become **teachers**; the class teacher becomes a **TA** on each of the class's courses.
- **Students:** everyone in the class, except where the school recorded subject choices for that year - then only those subjects. Anyone with marks in a course they are no longer in is added as `dropped`, so the marks stay visible.
- **Assignment groups:** the class's own grading groups, else the term defaults, merged by name across terms (earliest term's weight).
- **Marks:** each old grade becomes the submission score (the grade wins if both exist). Manual assessments with no activity become **offline** activities. Excluded marks become **excused**; excluded assessments become **omit from final grade**.

## 4. Hosted project settings (before the platform migration only)

**Required**

- **Expose the `course` schema** to the API: Settings > API > Exposed schemas, add `course`. Without it every course call failed with `PGRST106`. Not needed since the API moved to Prisma.

**For single sign-on** (skip if you are not using it)

- Authentication > URL Configuration > Redirect URLs: add `https://<api host>/api/auth/sso/callback`.
- Authentication > Providers: enable **Google** and/or **Azure** with your OAuth app's client ID and secret. Azure URL: `https://login.microsoftonline.com/common/v2.0`.
- SAML is now configured per email domain by the school admin; see [Single sign-on](./sso.md). The provider settings above were replaced by `GOOGLE_*` / `MICROSOFT_*` on the API.
- Full walkthrough: [Single sign-on](./sso.md).

## 5. Backend environment

Add to the API's environment (`backend/.env` locally; `infrastructure/.env` or your host's settings in production). Existing variables are unchanged.

| Variable | Needed for | Value |
| --- | --- | --- |
| `API_URL` | SSO, QR links | Public origin of the API, no `/api` (e.g. `https://api.example.com`) |
| `FRONTEND_URL` | QR codes | Already required; the attendance QR encodes `<first origin>/scan`, so it must be the address phones can open |
| `SSO_PROVIDERS` | SSO | Adapters to offer: `google,azure,saml` (any subset). Empty = SSO off |
| `MOBILE_SSO_RETURN_URL` | SSO in the app | Default `gradebook://sso`; change only if the app's URL scheme changes |
| `EXPO_ACCESS_TOKEN` | Push (optional) | Only if push security is enabled on your Expo account |
| `ALLOW_UNVERIFIED_EMAIL_DOMAINS` | Local dev only | `true` skips the DNS check for school domains. **Ignored when `NODE_ENV=production`** |
| `USE_REDIS`, `REDIS_URL` | Realtime | Already supported; needed with more than one API instance so live attendance and QR rotation reach every instance |

If you host under a multi-part domain such as `app.srmss.edu.gd`, set `AUTH_COOKIE_DOMAIN` explicitly - deriving it would produce `.edu.gd`, which browsers reject.

## 6. Web environment

Nothing new is required. `NEXT_PUBLIC_API_URL` as before. The site's `Permissions-Policy` header now allows `geolocation=(self)` so attendance location checks work.

## 7. Mobile app (required for the new mobile features)

The app gained native modules, so a **new build** is needed - over-the-air updates are not enough.

1. Dependencies were aligned to Expo SDK 57 (`expo-router` and `expo-system-ui` had drifted to SDK 58, which broke iOS bundling). New: `expo-notifications`, `expo-device`, `expo-location`, `expo-camera`, `react-native-qrcode-svg`, `expo-web-browser`.
2. `ios/` is committed, so regenerate it: `cd mobile && npx expo prebuild -p ios`. Check the diff for the new camera, location and notification entries.
3. **Push notifications:**
   - `eas init` in `mobile/` to set `extra.eas.projectId` (the app skips push registration and logs a warning without it).
   - iOS: push credentials via EAS during `eas build`.
   - Android: a Firebase project, `google-services.json`, and the FCM key uploaded to EAS.
   - Push only works on physical devices with a dev or store build, not Expo Go or simulators.
4. Build: `eas build --profile development` (or `production`), or `npx expo run:ios` / `run:android`.

## 8. Removed things

- **Backend modules:** class, subject, enrollment, class attendance, calculation, reporting, report-files, and the assessment / grade / grading-group endpoints. Old `/api/classes`, `/api/subjects`, `/api/reports`... routes now 404.
- **Edge functions:** `dashboard-summary`, `report-class-summary`, `attendance-summary`, `grade-analytics`, `large-report-export`. Nothing calls them, and no edge functions remain at all. The dashboard is computed by the API now.
- **Permissions:** catalog resources `class`, `subject`, `enrollment`, `assessment`, `grade`, `reporting`, `calculation`, `attendance` are gone, replaced by `course`. Their rows stay in `permission_catalog` (the boot sync only logs them) and grant nothing. Teachers get `course:create`; work inside a course is governed by the course role (teacher / TA / student), not the catalog. Review custom roles that relied on the removed resources.
- **Web pages:** `/dashboard/classes*` and `/dashboard/subjects*` redirect to `/dashboard/courses`; portal reports and attendance pages are gone.

## 9. After deploying

- Sign in as an admin, open **Courses**, open a migrated course, check **Grades** against a known report.
- As a teacher, take attendance in a published course; check in as a student from a phone (QR or code).
- If schools will use domains or SSO: **Admin > Email Domains**, add the domain, publish the TXT record, Verify, then set the sign-in provider.

## 10. Later: cleanup migration

Once production has run on courses for a while and nobody needs the old data, a cleanup migration (not yet written) drops `student_group`, `subject`, the staff assignment tables, class enrolment and subject profiles, `grading.assessment` / `grade` / `grading_group`, the `reporting` schema, class attendance, the legacy columns on `grading.activity`, and the retired permission rows. Take a backup first.

## Local development

```bash
bun install
cp backend/.env.example backend/.env   # defaults match docker-compose.dev.yml
bun run preload          # Postgres, Redis, S3, Mailpit (docker-compose.dev.yml), then prisma migrate deploy
bun run dev
bun run seed:demo                      # demo school with courses, work, grades, attendance, email domains
bun run seed:demo otp student@demo.test   # sign-in code without email
```

`bun run preload` uses `docker-compose.dev.yml` (Postgres on `127.0.0.1:5432`, Redis on `127.0.0.1:6379` with no password, S3 on `:8333`, Mailpit on `:8025`). The production compose file in `infrastructure/` needs `infrastructure/.env` with `REDIS_PASSWORD`.
