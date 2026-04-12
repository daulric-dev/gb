# Enrollment Module

**Location**: `backend/src/enrollment/`

The enrollment module handles two key operations:
1. **Student Enrollment** - adding/removing students from a class
2. **Subject Assignment** - assigning subjects to individual students within a class

## Files

| File | Purpose |
|------|---------|
| `enrollment.module.ts` | Module definition; imports `ClassModule` for `ClassTeacherGuard` |
| `enrollment.controller.ts` | API endpoints under `classes/:classId` |
| `enrollment.service.ts` | Business logic |
| `dto/enroll-student.dto.ts` | Single student enrollment |
| `dto/bulk-enroll.dto.ts` | Bulk student enrollment |
| `dto/assign-subjects.dto.ts` | Subject assignment for one student |
| `dto/bulk-assign-subjects.dto.ts` | Bulk subject assignment |

## Data Model

### Student Group Enrollment (`student` schema)

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `student_id` | UUID | The student |
| `student_group_id` | UUID | The class |
| `enrolled_at` | timestamp | When the student was enrolled |

### Student Subject Profile (`student` schema)

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `student_id` | UUID | The student |
| `subject_id` | UUID | The subject |
| `academic_year_id` | UUID | The academic year |

## Access Control

The enrollment controller splits access between read and write operations:

| Operation | Guard | Who Can Access |
|-----------|-------|----------------|
| View enrolled students | `AuthGuard` only | Any teacher assigned to the class |
| View student subjects | `AuthGuard` only | Any teacher assigned to the class |
| Enroll/unenroll students | `AuthGuard` + `ClassTeacherGuard` | Class teacher or admin only |
| Assign/remove subjects | `AuthGuard` + `ClassTeacherGuard` | Class teacher or admin only |

## Student Visibility Rules

The `getEnrolledStudents` method applies role-based filtering:

| Role | Students Visible |
|------|-----------------|
| Admin | All enrolled students |
| Class Teacher | All enrolled students |
| Subject Teacher | Only students assigned to at least one subject that the teacher teaches in this class |

Additionally, the response includes a `subjects` array on each student showing their assigned subject names and codes. For subject teachers, this is limited to subjects they teach.

## API Endpoints

All endpoints are nested under `classes/:classId` and require `AuthGuard`.

### `GET /api/v1/classes/:classId/students`

Returns enrolled students with their assigned subjects.

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `subjectId` | No | Filter to students assigned to a specific subject |

The `subjectId` parameter is used by the grading page to only show students who take the subject being graded.

**Response:**
```json
[
  {
    "id": "enrollment-uuid",
    "enrolled_at": "2025-09-01T00:00:00Z",
    "student": {
      "id": "student-uuid",
      "first_name": "Jane",
      "last_name": "Doe",
      "gender": "female",
      "date_of_birth": null,
      "is_active": true
    },
    "subjects": [
      { "id": "uuid", "name": "Mathematics", "code": "MATH" },
      { "id": "uuid", "name": "Language Arts", "code": "ENG" }
    ]
  }
]
```

---

### `GET /api/v1/classes/:classId/students/:studentId/subjects`

Returns the subjects assigned to a specific student, with full subject details.

---

### `POST /api/v1/classes/:classId/enroll`

**Requires:** `ClassTeacherGuard`

Enrolls a single student.

**Body:**
```json
{ "studentId": "uuid" }
```

**Error:** `409 Conflict` if already enrolled.

---

### `POST /api/v1/classes/:classId/enroll/bulk`

**Requires:** `ClassTeacherGuard`

Enrolls multiple students at once.

**Body:**
```json
{ "studentIds": ["uuid1", "uuid2", "uuid3"] }
```

---

### `DELETE /api/v1/classes/:classId/enroll/:studentId`

**Requires:** `ClassTeacherGuard`

Unenrolls a student. **Also deletes all their subject assignments** for the academic year.

---

### `POST /api/v1/classes/:classId/subjects`

**Requires:** `ClassTeacherGuard`

Assigns subjects to a student.

**Body:**
```json
{
  "studentId": "uuid",
  "subjectIds": ["uuid1", "uuid2"]
}
```

---

### `POST /api/v1/classes/:classId/subjects/bulk`

**Requires:** `ClassTeacherGuard`

Assigns subjects to multiple students at once.

**Body:**
```json
{
  "studentIds": ["uuid1", "uuid2"],
  "subjectIds": ["uuid1", "uuid2"]
}
```

Creates a subject profile for every combination of student × subject.

---

### `DELETE /api/v1/classes/:classId/students/:studentId/subjects/:subjectId`

**Requires:** `ClassTeacherGuard`

Removes a subject from a student. Fails with `409 Conflict` if the student has existing grades for that subject (foreign key constraint).
