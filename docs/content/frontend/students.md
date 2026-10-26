---
sidebar_label: Students
---

# Students Page

**Route**: `/dashboard/students`  
**File**: `app/dashboard/students/page.tsx`

This page manages the school's student records. Staff do not create students: a record appears when a signed-up user joins as a student (the school join code, or a verified student email domain), and can then be enrolled into courses.

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

### Edit Student

A form pre-filled with the student's first and last name, gender, date of birth and enrollment date, plus an **Active** toggle to enable/disable the student.

## API Calls

| Action | Endpoint |
|--------|----------|
| List/Search | `GET /api/students?search=<query>` |
| Update | `PATCH /api/students/:id` |
