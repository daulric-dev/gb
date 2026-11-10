# Attendance alert DTOs (`src/attendance-alerts/dto`)

All in `attendance-alerts.dto.ts`; unknown fields are rejected.

| Class | Used by | Fields |
| --- | --- | --- |
| `ReportRangeDto` | every report route | `from`, `to` (`YYYY-MM-DD`, local school days, inclusive). |
| `AlertSettingsDto` | `PUT /attendance-alerts/settings` | `minRate` (1-100 or null), `windowDays` (7-120), `minSessions` (1-100), `consecutiveAbsences` (2-30 or null), `notifyTutor`, `notifyAdmins`, `notifyParents`, `emailStaff`. |
| `FormTutorDto` | `PUT /attendance-alerts/form-tutors` | `studentIds` (1-500 UUIDs), `tutorId` (UUID or null). |
| `AlertListDto` | `GET /attendance-alerts` | `status`: `open` (default), `resolved`, `all`. |
