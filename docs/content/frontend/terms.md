---
sidebar_label: Terms
---

# Terms

**Route**: `/dashboard/academic-calendar` (Terms tab)
**File**: `app/dashboard/academic-calendar/_components/TermsTab.tsx`

Term management lives on the Academic Calendar page under the **Terms** tab. Terms are grouped under their parent academic year so the relationship between a year and its terms is always visible.

## Features

### Grouped by Academic Year

Each academic year renders as its own section showing:
- Year name with active/inactive and grading-model badges
- An **Add Term** button per year (disabled when the year already has 3 terms or uses year-based grading)
- A table of that year's terms (or an empty state)

Year-based grading years show an explanatory note instead of a table because they don't use terms.

### Term Row

Each term row in the table shows:
- Term name (Michaelmas, Hilary, Trinity)
- Date range (start → end)
- Exam / coursework weight badge
- Ministry reporting indicator
- Edit and Delete buttons

### Create Term

A dialog opened from the year section's **Add Term** button with:

| Field | Required | Description |
|-------|----------|-------------|
| Name | Yes | `michaelmas`, `hilary`, or `trinity` (only unused names are offered) |
| Start Date | Yes | Term start |
| End Date | Yes | Term end |
| Exam Weight | Yes | Percentage (0-100) |
| Coursework Weight | Yes | Percentage (must sum to 100 with exam) |
| Ministry Reporting | No | Toggle for ministry reporting period |

### Edit Term

Same form pre-filled with existing data.

### Delete Term

Confirmation dialog. Fails if the term has existing assessments (shows error toast).

## API Calls

| Action | Endpoint |
|--------|----------|
| List academic years | `GET /api/academic-years` |
| List terms (per year) | `GET /api/terms?yearId=<id>` |
| Create | `POST /api/terms` |
| Update | `PATCH /api/terms/:id` |
| Delete | `DELETE /api/terms/:id` |

The Terms tab fetches terms in parallel for each academic year (`Promise.all` over the years list) so all groups load together.
