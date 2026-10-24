---
sidebar_label: Terms
---

# Terms

**Route**: `/dashboard/academic-calendar` (Terms tab)
**File**: `app/dashboard/academic-calendar/_components/TermsTab.tsx`

Term management lives on the Academic Calendar page under the **Terms** tab. Terms are grouped under their parent academic year so the relationship between a year and its terms is always visible.

A term is a named date range inside a year. Courses can be tied to a term; terms carry no grading weights.

## Features

### Grouped by Academic Year

Each academic year renders as its own section showing:
- Year name with an active/inactive badge
- An **Add Term** button (for users with `term:create`)
- A table of that year's terms (or an empty state)

### Term Row

Each term row in the table shows:
- Term name (free text - "Term 1", "Fall", "Semester 2"; older rows stored as `michaelmas` / `hilary` / `trinity` are shown title-cased)
- Start and end dates
- Edit and Delete buttons (per the user's `term:update` / `term:delete` permissions)

### Create Term

A dialog opened from the year section's **Add Term** button:

| Field | Required | Description |
|-------|----------|-------------|
| Name | Yes | Free text, up to 60 characters; must be unique within the year. Defaults to "Term N" |
| Start Date | Yes | Term start |
| End Date | Yes | Term end; must be after the start |

The term is placed after the year's existing terms.

### Edit Term

Same form pre-filled with the term's name and dates.

### Delete Term

Asks for confirmation. Fails with an error toast if courses still use the term.

## API Calls

| Action | Endpoint |
|--------|----------|
| List academic years | `GET /api/academic-years` |
| List terms (per year) | `GET /api/terms?yearId=<id>` |
| Create | `POST /api/terms` |
| Update | `PATCH /api/terms/:id` |
| Delete | `DELETE /api/terms/:id` |

The Terms tab fetches terms in parallel for each academic year (`Promise.all` over the years list) so all groups load together.
