---
sidebar_label: Dashboard
---

# Dashboard Page

**Route**: `/dashboard`  
**File**: `app/dashboard/page.tsx`

The dashboard is the landing page after login. It shows a personalized greeting and key statistics about the current academic year.

## Layout

**File**: `app/dashboard/layout.tsx`

The dashboard layout wraps all `/dashboard/*` routes with:
- **Header component** at the top (navigation, user menu)
- **Main content area** centered with max width

The layout fetches the user profile via `useProfile()` and passes it to the Header.

## Dashboard Content

### Greeting Section
- Displays "Good morning/afternoon/evening, \{firstName\}" based on the current time
- Shows the user's school name beneath the greeting

### Statistics Cards

Fetches data from:
- `GET /api/academic-years/active` - the current active academic year
- `GET /api/classes` - the user's assigned classes

Displays:
| Card | Content |
|------|---------|
| Academic Year | Name of the active year, or "No active year" |
| My Classes | Count of classes the user teaches |

### Current Academic Year Card

If an active academic year exists, shows:
- Year name
- Date range (start → end)
- Grading model (Term-Based or Year-Based)
- Active status badge

## Navigation

The Header component provides navigation to all major sections:

| Link | Route |
|------|-------|
| Dashboard | `/dashboard` |
| Academic Years | `/dashboard/academic-years` |
| Classes | `/dashboard/classes` |
| Students | `/dashboard/students` |
| Subjects | `/dashboard/subjects` |
| Terms | `/dashboard/terms` |

On mobile, navigation collapses into a hamburger menu (Sheet component).

### User Dropdown

Located in the top-right corner:
- Avatar with initials
- User name and school
- Theme toggle
- Logout button → `POST /api/auth/logout`, clears tokens, redirects to `/login`
