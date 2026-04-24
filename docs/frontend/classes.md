# Classes Pages

The classes section consists of three pages: the class listing, the class detail page, and the grading page.

## Class Listing

**Route**: `/dashboard/classes`  
**File**: `app/dashboard/classes/page.tsx`

Displays the user's assigned classes in two sections:

### My Classes (Class Teacher)

Shows classes where the user is the class teacher. Each row displays:
- Class name
- Click to navigate to class detail

### My Subjects (Subject Teacher)

Shows classes where the user teaches subjects but is not the class teacher.

### Create Class

A dialog form (visible to all authenticated users) with:

| Field | Required | Description |
|-------|----------|-------------|
| Name | Yes | e.g., "Grade 3S" |
| Academic Year | Yes | Must have an active academic year |

The user who creates the class is automatically assigned as the class teacher.

---

## Class Detail Page

**Route**: `/dashboard/classes/[classId]`  
**File**: `app/dashboard/classes/[classId]/page.tsx`

This is the most feature-rich page in the application, with multiple sections.

### Page Header

- Class name (e.g., "Grade 3S")
- Role indicator: "You are the class teacher" or "You teach subjects in this class"
- **Grading** button → navigates to the grading page (all teachers)
- **Reports** button → navigates to the reports list page (class teacher only)
- **Class Report** button → navigates to the class summary page (class teacher only)
- **Enroll Students** button (class teacher only)

### Subject Teachers Card

Lists all teachers assigned to this class with their subjects:

| Element | Description |
|---------|-------------|
| Teacher name | Full name |
| Class Teacher badge | Shown for the class teacher |
| Subject badges | Colored chips for each assigned subject |
| Edit button | (Class teacher only) Opens subject assignment editor |
| Remove button | (Class teacher only) Removes the teacher from the class |

**Assign Teacher dialog** (class teacher only):
- Select a teacher from the school
- Select which subjects they'll teach
- Teachers already assigned to the class are filtered out

**Edit Teacher Subjects dialog** (class teacher only):
- Checkbox list of all subjects
- Pre-checked with teacher's current assignments

### Enrolled Students Card

Shows students enrolled in the class:

| Column | Description |
|--------|-------------|
| Name | Student full name |
| Gender | Badge |
| Enrolled | Enrollment date |
| Subjects | **Class teacher**: "Manage" button to assign subjects; **Subject teacher**: Chips showing the student's subjects (limited to the teacher's assigned subjects) |
| Actions | (Class teacher only) Unenroll button |

**Manage Subjects dialog** (class teacher only):
- Lists currently assigned subjects with remove buttons
- "Add Subjects" expandable form with checkbox list

**Bulk Assign Subjects dialog** (class teacher only):
- Accessible via "Bulk Assign Subjects" button in the Enrolled Students card header (shown when students are enrolled)
- Subject dropdown to select which subject to assign
- Student list with checkboxes (shown after selecting a subject)
- Search bar to filter students by name
- "Select All / Deselect All" toggle that operates on unassigned students only
- Students already assigned to the selected subject show an "Assigned" badge with a disabled checkbox
- Calls `POST /api/classes/:id/subjects/bulk` with the selected subject and student IDs

**Enroll Students dialog** (class teacher only):
- Lists all school students not already enrolled
- Multi-select with bulk enrollment support

### Class Summary Card

**Visible to**: Class teachers only

Displays a table of all students with their per-subject grades and class rankings.

#### Term View

| Column | Description |
|--------|-------------|
| # | Position/ranking |
| Student | Name + Overall badge (e.g., "Overall - 82.3%") |
| Per-subject columns | Term composite grade for each subject |

**Controls:**
- Term selector dropdown
- Rows-per-page selector (10, 20, 50)
- Pagination (previous/next)

#### Year View (year_based model only)

Available when the academic year uses the `year_based` grading model. Shows a toggle between "Term" and "Year" views.

| Column | Description |
|--------|-------------|
| # | Position/ranking |
| Student | Name + Overall year-end badge |
| Per-subject groups | Each subject has sub-columns for each term + a "YR" (year-end) column |

## API Calls

| Action | Endpoint |
|--------|----------|
| List classes | `GET /api/classes` |
| Create class | `POST /api/classes` |
| Get teachers | `GET /api/classes/:id/teachers` |
| Add teacher | `POST /api/classes/:id/teachers` |
| Remove teacher | `DELETE /api/classes/:id/teachers/:teacherId` |
| Get enrolled students | `GET /api/classes/:id/students` |
| Enroll student | `POST /api/classes/:id/enroll` |
| Bulk enroll | `POST /api/classes/:id/enroll/bulk` |
| Unenroll | `DELETE /api/classes/:id/enroll/:studentId` |
| Get student subjects | `GET /api/classes/:id/students/:sid/subjects` |
| Assign subjects | `POST /api/classes/:id/subjects` |
| Bulk assign subjects | `POST /api/classes/:id/subjects/bulk` |
| Remove subject | `DELETE /api/classes/:id/students/:sid/subjects/:subjectId` |
| Class summary (term) | `GET /api/calculations/class-summary?termId=&studentGroupId=` |
| Class summary (year) | `GET /api/calculations/class-year?academicYearId=&studentGroupId=` |
| Academic year details | `GET /api/academic-years/:id` |
| Terms | `GET /api/terms?yearId=` |
| School teachers | `GET /api/classes/school-teachers` |
| All subjects | `GET /api/subjects` |
