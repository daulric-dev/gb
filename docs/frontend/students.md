# Students Page

**Route**: `/dashboard/students`  
**File**: `app/dashboard/students/page.tsx`

This page manages the school's student records. Students created here can be enrolled into classes and assigned to subjects.

## Features

### Student List

A searchable table displaying all students:

| Column | Description |
|--------|-------------|
| Name | First and last name |
| Gender | Badge showing gender |
| Date of Birth | Formatted date |
| Status | Active/Inactive badge |
| Actions | Edit button |

### Search

A text input with **300ms debounce** that searches by first or last name. The search is performed server-side via the `search` query parameter.

### Create Student

A dialog form with:

| Field | Required | Description |
|-------|----------|-------------|
| First Name | Yes | |
| Last Name | Yes | |
| Gender | Yes | Select dropdown |
| Date of Birth | No | Date input |
| Enrollment Date | No | Date input |

### Edit Student

Same form pre-filled with existing data, plus an **Active** toggle to enable/disable the student.

## API Calls

| Action | Endpoint |
|--------|----------|
| List/Search | `GET /api/v1/students?search=<query>` |
| Create | `POST /api/v1/students` |
| Update | `PATCH /api/v1/students/:id` |
