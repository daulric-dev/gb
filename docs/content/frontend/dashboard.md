---
sidebar_label: Dashboard
---

# Dashboard Page

**Route**: `/dashboard`
**File**: `app/dashboard/page.tsx` (components in `app/dashboard/_components/`)

The landing page for staff. It loads `GET /api/dashboard/summary` (type `DashboardSummary` in `_components/types.ts`) and picks a layout:

| Caller | Teaches or assists in a course? | View |
| --- | --- | --- |
| Admin (`course:update`) | Yes | Tabs: School overview \| My courses |
| Admin | No | School overview only |
| Anyone else | - | My courses (with an empty state and a "New course" prompt if none) |

## My courses (`TeacherDashboard.tsx`)

- Stat cards: **Active courses**, **Enrolled students**, **Due soon** (work due across the caller's courses), **Awaiting marking** (submissions handed in and not yet graded).
- A card per course (archived ones left out) with role, student count and how many submissions wait for marking, linking to the course.
- **Coming up**: the next due work across those courses, fetched per course from `GET /api/courses/:courseId/activities`.

## School overview (`AdminDashboard.tsx`)

From `summary.school`:

- Stat cards: **Active year**, **Published courses**, **Active students**, **Staff**.
- Charts (Recharts via `components/ui/chart`): courses by status, staff composition, student distribution.
- **Recent activity**: courses created, work published and announcements, newest first.
- **Current academic year** card when one is active.

## Data

```ts
GET /api/dashboard/summary → {
  schoolId, isAdmin,
  activeYear: { id, name, startDate, endDate } | null,
  myCourses: { id, name, code, status, role, studentCount, awaitingMarking }[],
  awaitingMarking,
  school: {                       // admins only, else null
    courses: { total, draft, published, archived },
    students: { total, active },
    staff: { total, admins, teachers, members },
    recentActivity: { type, id, title, courseId, courseName, at }[]
  } | null
}
```

The summary is computed in the API (`backend/src/dashboard/dashboard.service.ts`) from the course tables.
