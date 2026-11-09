# Timetable (`src/timetable`)

Rooms, the school's bell schedule, non-school days, and a weekly or rotating timetable for each course, plus a scheduler that **opens a check-in session automatically at the start of each period and lets it close at the period's end**. Behind the **`timetable`** feature (off by default; requires `attendance`; see [`src/features`](../features/README.md)). User guide: [docs/content/guide/timetable.md](../../../docs/content/guide/timetable.md).

## Concepts

- **School time zone.** `public.school.time_zone` (IANA name, default `UTC` for every existing school). All period times are local wall-clock minutes in this zone; `src/common/time-zone.ts` turns a local date + minute into an instant with `Intl` only (no library), so a 09:00 period is 09:00 local on both sides of a daylight-saving change. A time the clocks skip lands just after the gap; a time that happens twice is its first occurrence. An admin must set the real zone on the setup page before relying on the automatic sessions.
- **Bell schedule.** `public.bell_period` (named, ordered) with `public.bell_period_time` rows per ISO weekday (1 = Monday). Different times per weekday (a short Friday) are different rows; a period with no row for a weekday does not run that day.
- **Rooms.** `public.room`, unique name per school, with an optional saved location (`latitude`, `longitude`, `radius_m` 10-1000, default 50; all or none).
- **Closures.** `public.school_closure` (inclusive date ranges: holidays, closures). Nothing is scheduled on them. There was no calendar of non-school days before this module; this is a minimal one.
- **Settings.** `public.timetable_setting` (one row per school, defaults when absent): `cycle_length` (null = weekly, else 2-20 days) and `cycle_start_date` (cycle day 1), `school_days` (ISO weekdays open, default Mon-Fri), `auto_sessions` (default on), `lead_minutes` (0-30), `late_after_minutes` (from the period start; null = never late), `require_code` (default on).
- **Rotating cycle.** The cycle day of a date is the number of school days (an open weekday that is not a closure) from `cycle_start_date` up to it, modulo the length, plus one. Weekends and closures do not advance the cycle; dates before the start or on non-school days have no cycle day (`SchoolCalendar` in `occurrences.ts`, memoised).
- **Entries.** `course.timetable_entry`: a period on a `weekday` (weekly) **or** a `cycle_day` (rotating), an optional room, and optional `valid_from` / `valid_to` that must lie inside the course's term; without them the term's dates bound the entry. A cycle-day entry never occurs while the school is weekly.
- **Occurrences** are computed, not stored: `occurrencesBetween(from, to, …)` (pure, `occurrences.ts`) gives each entry on each matching date with its local start/end, room, and status `scheduled`, `cancelled` or `moved`. An occurrence's key is the entry plus its **scheduled** date (`occursOn`); `date` is where it actually happens.
- **Overrides.** `course.timetable_override` (unique per entry and scheduled date): `cancel`, or `move` to another date (within a month), start/end and/or room. A cancelled occurrence is still listed (with its note); a move out of a range drops it from that range and a move in from another day adds it.
- **Claims.** `course.timetable_occurrence` (primary key entry + scheduled date): the scheduler's record that it handled an occurrence: `opened` with `session_id`, or `skipped` with a `reason`. `session_id` is set to null if staff delete the session; the row stays, so it is never reopened.

## Automatic sessions (`TimetableScheduler`)

Every minute in each API instance (first run 20 s after start), inside a transaction holding `pg_try_advisory_xact_lock(hashtext('gradebook:timetable'))`, so one instance runs at a time. It uses Postgres only: **no Redis or BullMQ needed**. Off under `NODE_ENV=test` or with `TIMETABLE_SCHEDULER=false`.

1. Find schools with timetable entries in published, non-template courses; skip those where `timetable` is not effective or `auto_sessions` is off.
2. Compute yesterday's and today's occurrences in the school's zone; keep those not cancelled where `startsAt - lead_minutes <= now < endsAt`.
3. **Claim** each with an insert into `timetable_occurrence` (`ON CONFLICT DO NOTHING`); only the caller whose insert succeeded goes on. This is what makes it idempotent across ticks, retries and instances.
4. Open the session with `AttendanceService.openScheduled(courseId, …)`: no `opened_by`, title `<period> · <room>`, a code when `require_code`, `late_after_minutes` counted from the period's start (whenever the session actually opened), the **room's saved location as the geofence point** (no location check for a room without one), and `closes_at` = the period's end. The attendance sweep then closes it at that time and records absentees exactly as for a manual session. Students get the usual push and portal event. Live teacher location still works: any staff member can switch on **Share my location** on the session page and the point follows them (sharing is on by default only for the opener, and an automatic session has none).
5. If opening fails (a session is already open in the course, the course was unpublished), the claim becomes `skipped` with the message; the occurrence is not retried.

Cancelling or moving an occurrence that has already been claimed is refused (409): close or delete the session instead.

## HTTP routes

All need `AuthGuard` and `FeatureGuard` with `@RequireFeature('timetable')` (403 `FEATURE_DISABLED` while off). Ids are UUIDs; dates are `YYYY-MM-DD`; times are minutes after local midnight. A read range covers at most 62 days.

### School setup (`SchoolTimetableController`, `/api/schools/current/timetable`, + `PermissionGuard`)

| Method | Path | Permission | What it does |
| --- | --- | --- | --- |
| GET | `/` | `school:read` | `{ settings (with timeZone), rooms, periods, closures, today }`. |
| GET | `/cycle?from&to` | `school:read` | `{ from, to, today, days: [{ date, weekday, schoolDay, closed, cycleDay }] }` (default 4 weeks from today) to check the rotation. |
| PATCH | `/settings` | `school:update` | `UpdateTimetableSettingsDto`. 400 for an unknown time zone, a cycle without a start date, or no school days. Returns the settings. |
| POST / PATCH / DELETE | `/rooms`, `/rooms/:roomId` | `school:update` | `RoomDto` `{ name, location: { latitude, longitude, radiusM? } \| null }`. 409 for a duplicate name; another school's room is 404. Deleting a room leaves its entries without a room. |
| POST / PATCH / DELETE | `/periods`, `/periods/:periodId` | `school:update` | `PeriodDto` `{ name, position, times: [{ weekday, startMinute, endMinute }] }` (`times` replaces all). 400 when a period ends before it starts or a weekday repeats; 409 for a duplicate name. Deleting a period deletes its entries. |
| POST / DELETE | `/closures`, `/closures/:closureId` | `school:update` | `ClosureDto` `{ name, startDate, endDate }` (at most a year). |

### Course (`CourseTimetableController`, `/api/courses/:courseId/timetable`)

Access is the caller's course role (`CourseAccessService`): any staff role reads, `admin`/`teacher` (`MANAGE_ROLES`) change. Another school's course is 404.

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/` | Course staff | `{ canEdit, entries, settings, periods, rooms, term }`. |
| POST / PATCH / DELETE | `/entries`, `/entries/:entryId` | Teacher / admin | `TimetableEntryDto` `{ periodId, roomId, weekday \| cycleDay, validFrom, validTo }`. 400 for a period or room of another school, both or neither day kind, a cycle day on a weekly timetable or beyond the cycle, or dates outside the term. On PATCH, giving one day kind clears the other. |
| GET | `/occurrences?from&to` | Course staff | `{ from, to, today, occurrences }` (default the next 7 days), each with `session: { id, state, reason } \| null`. |
| PUT | `/occurrences/:entryId/:date` | Teacher / admin | `OccurrenceOverrideDto` `{ kind: 'cancel' \| 'move', date?, startMinute?, endMinute?, roomId?, note? }` for the occurrence scheduled on `:date`. 404 if the entry does not run that day; 409 once its session has opened. |
| DELETE | `/occurrences/:entryId/:date` | Teacher / admin | Undo the cancel or move (204). 409 once opened. |

### Staff and students

| Method | Path | Guards | What it does |
| --- | --- | --- | --- |
| GET | `/api/timetable/me?from&to` | `AuthGuard` | The caller's periods in their active school (courses where they are `course_staff`, draft or published), default today, with session state and `timeZone`. The "today" view. |
| GET | `/api/portal/me/timetable?from&to` | `AuthGuard`, `StudentGuard` | The student's periods (active enrolments in published courses of their school), default this week Monday-Sunday; no session state. |

`TimetableOccurrence`: `{ entryId, courseId, courseName, courseCode, periodId, periodName, occursOn, date, startMinute, endMinute, startsAt, endsAt, roomId, roomName, status, note, cycleDay, session? }`.

## Services / exports

- `TimetableService` (exported): `context(schoolId)` (zone, settings, closures, periods, rooms), `occurrencesFor(ctx, courseIds, from, to, { withSessions })`, the setup and course methods above, `range()`.
- `TimetableScheduler`: `tick(now)` (lock + run), `run(now)`, `isDue()`, `openOccurrence()`.
- `occurrences.ts`: `SchoolCalendar`, `occurrencesBetween`, `occurrenceInstants`.

## Depends on

- `AttendanceModule` (`AttendanceService.openScheduled`, now exported) and `StudentPortalModule` (`StudentGuard`).
- Global: `PrismaService`, `FeatureService`, `CourseAccessService`, `PermissionGuard`.
- `src/common/time-zone.ts`, `src/common/user-school.ts`, `src/common/db-values.ts`.

## Data

Migration `20261118100000_timetable`: `public.school.time_zone`; `public.timetable_setting`, `public.room`, `public.bell_period`, `public.bell_period_time`, `public.school_closure`; `course.timetable_entry`, `course.timetable_override`, `course.timetable_occurrence`. Models in [`prisma/schema/timetable.prisma`](../../prisma/schema/timetable.prisma). Everything cascades with its school or course; `created_by` / `updated_by` have no foreign key.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `TIMETABLE_SCHEDULER` | `true` | `false` stops the automatic sessions in this instance. |
| `NODE_ENV` | | `test` turns the scheduler off. |

## Files

| File | Purpose |
| --- | --- |
| `timetable.module.ts` | Imports `AttendanceModule` and `StudentPortalModule`; four controllers, the service and the scheduler. |
| `timetable.controller.ts` | `SchoolTimetableController`, `CourseTimetableController`, `MyTimetableController`, `PortalTimetableController`. |
| `timetable.service.ts` | Setup, entries, overrides and the dated views. |
| `timetable.scheduler.ts` | Automatic sessions. |
| `occurrences.ts` | Pure occurrence and cycle maths. |
| `dto/timetable.dto.ts` | Request bodies and the `from`/`to` query. |

## Tests

```bash
cd backend && bun test src/timetable src/common/time-zone.test.ts
```

- `occurrences.test.ts`: weekly occurrences, entry/term bounds, per-weekday times (and none), closures and non-school weekdays, rotating cycle days skipping weekends and closures, a cycle start on a weekend, memo-order independence, cycle entries on a weekly timetable, cancel, move (same day, out of and into a range), and period instants across the London DST change.
- `timetable.scheduler.test.ts`: opens with the room's location (and without for a room without one), closes at the period end, late counted from the period start; **idempotent** across ticks; lead time, end and cancelled occurrences; a conflict marks it skipped and is not retried; nothing with the feature off, automatic sessions off or without the lock.
- `timetable.service.test.ts`: TA read-only, another course 404, entry validation, cancel/move only a real, unopened occurrence, settings validation, ranges.
- `timetable.feature.test.ts`: every timetable (and attendance report/alert) controller is off by default, on when the organisation turns it on, and off when the school turns `attendance` off.
- `src/common/time-zone.test.ts`: zone validation, wall time to UTC across DST (gap and overlap), local parts, day arithmetic.
- `src/attendance/attendance.service.test.ts` (`openScheduled`): the session uses the given point, no opener, closes at the period end; unpublished, ended and already-open are refused.
