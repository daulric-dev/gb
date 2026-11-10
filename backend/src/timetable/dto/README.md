# Timetable DTOs (`src/timetable/dto`)

All in `timetable.dto.ts`; unknown fields are rejected. Dates are `YYYY-MM-DD`, times are minutes after local midnight in the school's time zone.

| Class | Used by | Fields |
| --- | --- | --- |
| `UpdateTimetableSettingsDto` | `PATCH /schools/current/timetable/settings` | `timeZone` (IANA), `cycleLength` (2-20 or null = weekly), `cycleStartDate`, `schoolDays` (ISO weekdays 1-7), `autoSessions`, `leadMinutes` (0-30), `lateAfterMinutes` (0-240 or null), `requireCode`. |
| `RoomDto` | `POST/PATCH .../rooms` | `name` (1-100), `location` `{ latitude, longitude, radiusM? (10-1000) }` or null. |
| `PeriodDto` / `PeriodTimeDto` | `POST/PATCH .../periods` | `name` (1-60), `position`, `times: [{ weekday, startMinute, endMinute }]` (replaces all). |
| `ClosureDto` | `POST .../closures` | `name`, `startDate`, `endDate`. |
| `TimetableEntryDto` | `POST/PATCH /courses/:courseId/timetable/entries` | `periodId`, `roomId`, `weekday` or `cycleDay`, `validFrom`, `validTo`. |
| `OccurrenceOverrideDto` | `PUT /courses/:courseId/timetable/occurrences/:entryId/:date` | `kind` (`cancel` / `move`), `date`, `startMinute`, `endMinute`, `roomId`, `note` (≤ 200). |
| `RangeQueryDto` | timetable reads | `from`, `to`. |
