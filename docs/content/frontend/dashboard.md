---
sidebar_label: Dashboard
---

# Dashboard Page

**Route**: `/dashboard`  
**File**: `app/dashboard/page.tsx`

The dashboard is the landing page after login. It is **role-aware**: pure administrators (no teaching assignments) see a school overview with charts; teachers - and any admin who is also assigned to a class - see a teaching overview with class stats and a subject-performance chart.

## View selection

After loading the user profile (`/auth/me`) and class list (`/classes`), the page chooses between two layouts:

| Role | Has any entry in `/classes`? | View |
|------|------------------------------|------|
| `admin` | No  | Admin school overview only |
| `admin` | Yes (class teacher **or** subject teacher) | **Tabbed**: School Overview \| My Classes (defaults to School Overview) |
| `teacher` / `member` / other | n/a | Teacher overview only (with empty state if no classes) |

`/classes` returns only classes the user is assigned to (via `staff.teacher_group_assignment`) along with an `isClassTeacher` flag per class - see `frontend/app/dashboard/page.tsx`. Admins who also teach get both views as tabs so they can flip between school administration and their day-to-day teaching context without leaving the dashboard.

## Layout

**File**: `app/dashboard/layout.tsx`

The dashboard layout wraps all `/dashboard/*` routes with:
- **Header component** at the top (navigation, user menu)
- **Main content area** centered with max width

The layout fetches the user profile via `useProfile()` and passes it to the Header.

## Greeting

Both views show a "Hello \{firstName\}" heading at the top, followed by a one-line subtitle that names the active academic year and term (teacher view) or "Here's an overview of your school" (admin view).

## Admin overview (`AdminDashboard`)

**File**: `app/dashboard/_components/AdminDashboard.tsx`

Fetches `GET /api/academic-years/active` and shows:

| Card | Content |
|------|---------|
| Active Year | Name of the active academic year, or "-" |
| Your Classes | Count of classes the admin is personally assigned to |

If an active academic year exists, a **Current Academic Year** card with the year name, date range and grading model is rendered below the stat cards.

## Teacher overview (`TeacherDashboard`)

**File**: `app/dashboard/_components/TeacherDashboard.tsx`

Fetches:
- `GET /api/academic-years/active` - the active year (for grading model context).
- `GET /api/terms?yearId=…` - terms for the active year. Picks the term whose date range contains today, falling back to the most recently started term, then the first term by `sort_order`.
- For each class in `/classes`:
  - `GET /api/classes/:id/students` - student count.
  - `GET /api/calculations/class-term?termId=&studentGroupId=` - student-by-student term composites, aggregated client-side via `termResultsToClassSummary` (`frontend/lib/reports/calculations.ts`) using the term's coursework / exam weights.

Top stat cards:

| Card | Content |
|------|---------|
| My Classes | Number of classes the user is assigned to |
| Total Students | Sum of student counts across those classes |
| Average This Term | Average of class averages (across classes that have grades) |
| Pass Rate | Aggregate pass rate (`overallAverage ≥ 50`) across graded students |

A **Subject Performance** card renders a Recharts `BarChart` (via `@/components/ui/chart`) of average scores per subject, aggregated across the user's classes, with a dashed pass-mark reference line at 50%.

A **My Classes** grid lists one card per class with student count, class average, pass rate, a "Class Teacher" badge if applicable, and an "Open class" button linking to `/dashboard/classes/:id`.

If the user has no class assignments yet, the section is replaced with a friendly empty state.

## Navigation

The Header component provides navigation to all major sections:

| Link | Route |
|------|-------|
| Dashboard | `/dashboard` |
| Academic Calendar | `/dashboard/academic-calendar` |
| Classes | `/dashboard/classes` |
| Students | `/dashboard/students` |
| Subjects | `/dashboard/subjects` |

The Academic Calendar page hosts both year management and the **Terms** tab (terms grouped under each academic year).

On mobile, navigation collapses into a hamburger menu (Sheet component).

### User Dropdown

Located in the top-right corner:
- Avatar with initials
- User name and school
- Theme toggle
- Logout button → `POST /api/auth/logout`, clears tokens, redirects to `/login`
