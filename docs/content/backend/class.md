---
sidebar_label: Class
---

# Class Module

**Location**: `backend/src/class/`

The class module manages student groups (classes) and their teacher assignments. A "class" in the system is represented as a `student_group` in the database. Each class belongs to an academic year and has one class teacher who has full control, plus optional subject teachers.

## Files

| File | Purpose |
|------|---------|
| `class.module.ts` | Module definition; exports `ClassTeacherGuard` |
| `class.controller.ts` | API endpoints |
| `class.service.ts` | Business logic |
| `class-teacher.guard.ts` | Authorization guard for class teacher operations |
| `dto/create-class.dto.ts` | Validation for creation |
| `dto/update-class.dto.ts` | Validation for updates |
| `dto/add-teacher.dto.ts` | Validation for teacher assignment |

## Data Model

### Student Group (Class)

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `name` | string | Class name (e.g., "Grade 3S") |
| `academic_year_id` | UUID | The academic year this class belongs to |
| `created_by` | UUID | User who created the class |

### Teacher Group Assignment (`staff` schema)

| Field | Type | Description |
|-------|------|-------------|
| `user_profile_id` | UUID | Teacher's user profile |
| `student_group_id` | UUID | The class |
| `academic_year_id` | UUID | Academic year |
| `is_class_teacher` | boolean | Whether this teacher is the class teacher |

### Teacher Subject Assignment (`staff` schema)

| Field | Type | Description |
|-------|------|-------------|
| `user_profile_id` | UUID | Teacher's user profile |
| `subject_id` | UUID | The subject they teach |
| `student_group_id` | UUID | The class |
| `academic_year_id` | UUID | Academic year |

## ClassTeacherGuard

The `ClassTeacherGuard` restricts certain actions to the class teacher (or an admin). It reads the `:classId` route parameter and checks `teacher_group_assignment` for `is_class_teacher = true`.

**Access logic:**
1. Check `user_profile.role` - if `admin`, allow
2. Check `teacher_group_assignment` for this user + class - if `is_class_teacher`, allow
3. Otherwise, reject with `403 Forbidden`

## Roles and Visibility

| Role | Can See Classes | Can Modify Class | Can Manage Teachers |
|------|----------------|------------------|---------------------|
| Admin | All | Yes | Yes |
| Class Teacher | Their assigned classes | Yes (their own) | Yes (their own) |
| Subject Teacher | Classes they teach in | No | No |

## API Endpoints

All endpoints require `AuthGuard`.

### `GET /api/classes`

Returns all classes the authenticated user is assigned to (as class teacher or subject teacher).

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `academicYearId` | No | Filter by academic year |

**Response:** Array of class objects with `isClassTeacher` flag:
```json
[
  {
    "id": "uuid",
    "name": "Grade 3S",
    "academicYearId": "uuid",
    "isClassTeacher": true
  }
]
```

---

### `POST /api/classes`

Creates a new class. The creator is automatically assigned as the class teacher.

**Body:**
```json
{
  "name": "Grade 3S",
  "academicYearId": "uuid",
  "subjectIds": ["uuid1", "uuid2"]
}
```

The optional `subjectIds` array assigns subjects to the class teacher during creation.

---

### `GET /api/classes/:classId`

Returns a single class by ID.

---

### `PATCH /api/classes/:classId`

**Requires:** `ClassTeacherGuard`

Updates the class name.

---

### `DELETE /api/classes/:classId`

**Requires:** `ClassTeacherGuard`

Deletes the class and all associated data.

---

### `GET /api/classes/:classId/my-subjects`

Returns the subjects the current user can grade for this class.

**Access logic:**
- Admin or class teacher → all subjects in the school
- Subject teacher → only the subjects they're assigned to teach in this class

This endpoint is used by the grading page to populate the subject dropdown.

---

### `GET /api/classes/:classId/teachers`

Returns all teachers assigned to this class with their subjects.

**Response:**
```json
[
  {
    "teacherId": "uuid",
    "firstName": "John",
    "lastName": "Smith",
    "isClassTeacher": true,
    "subjects": [
      { "id": "uuid", "name": "Mathematics", "code": "MATH" }
    ]
  }
]
```

---

### `POST /api/classes/:classId/teachers`

**Requires:** `ClassTeacherGuard`

Adds a teacher to the class or updates their subject assignments. If the teacher is already assigned, their subjects are replaced.

**Body:**
```json
{
  "teacherId": "uuid",
  "subjectIds": ["uuid1", "uuid2"]
}
```

---

### `DELETE /api/classes/:classId/teachers/:teacherId`

**Requires:** `ClassTeacherGuard`

Removes a teacher from the class. **Cannot remove the class teacher** - returns `403 Forbidden`.

---

### `GET /api/classes/school-teachers`

Returns all teachers in the same school as the current user. Used when assigning teachers to a class.
