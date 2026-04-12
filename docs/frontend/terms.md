# Terms Page

**Route**: `/dashboard/terms`  
**File**: `app/dashboard/terms/page.tsx`

This page manages terms (semesters) within academic years. Terms define the time periods and grading weight splits for exams vs coursework.

## Features

### Academic Year Selector

A dropdown at the top to select which academic year's terms to manage. Defaults to the first academic year in the list.

### Term List

Displays terms as a table or card list with:
- Term name (Michaelmas, Hilary, Trinity)
- Date range (start → end)
- Exam weight percentage
- Coursework weight percentage
- Ministry reporting badge (if enabled)
- Edit and Delete buttons

### Create Term

A dialog form with:

| Field | Required | Description |
|-------|----------|-------------|
| Name | Yes | `michaelmas`, `hilary`, or `trinity` |
| Start Date | Yes | Term start |
| End Date | Yes | Term end |
| Exam Weight | Yes | Percentage (0-100) |
| Coursework Weight | Yes | Percentage (must sum to 100 with exam) |
| Ministry Reporting | No | Toggle for ministry reporting period |
| Sort Order | No | Display order (auto-set based on term name) |

### Edit Term

Same form pre-filled with existing data.

### Delete Term

Confirmation dialog. Fails if the term has existing assessments (shows error toast).

## API Calls

| Action | Endpoint |
|--------|----------|
| List academic years | `GET /api/v1/academic-years` |
| List terms | `GET /api/v1/terms?yearId=<id>` |
| Create | `POST /api/v1/terms` |
| Update | `PATCH /api/v1/terms/:id` |
| Delete | `DELETE /api/v1/terms/:id` |
