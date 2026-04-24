---
sidebar_label: Implementation Guide
---

# GGBv2 -Complete Implementation Guide

## Project Overview

Grade Book application for schools. Teachers create classes, enroll students, enter grades, and generate report cards. Supports multiple schools (multi-tenancy) with two grading models: TERM_BASED (primary) and YEAR_BASED (secondary).

| Component | Technology |
|---|---|
| Backend | NestJS |
| Frontend | Next.js |
| Database | PostgreSQL (Supabase-managed) |
| Auth | Supabase OTP (email-based, no passwords) |
| Storage | Supabase Storage (PDF report cards) |
| Package manager | Bun |

---

# PART A -Database

## 1. Schemas

5 custom schemas + auth (Supabase-managed):

| Schema | Purpose |
|---|---|
| `public` | Shared reference data: school, user_profile, academic_year, student_group, term, subject |
| `student` | Student data: student, student_group_enrollment, student_subject_profile, parent_student_link |
| `grading` | Grade entry: assessment, grade |
| `reporting` | Report cards: report_book, report_book_entry, report_book_pdf, class_report_file |
| `staff` | Teacher access: teacher_group_assignment, teacher_subject_assignment |
| `auth` | Supabase-managed: auth.users |

## 2. Enums

All lowercase values in the database.

| Enum | Values | Used in |
|---|---|---|
| schooltype | primary, secondary | school.school_type |
| role | admin, teacher | user_profile.role |
| gradingmodel | term_based, year_based | academic_year.grading_model |
| term_name | michaelmas, hilary, trinity | term.name |
| gender | male, female | student.gender |
| assessment_type | exam, coursework | assessment.assessment_type |
| report_book_status | draft, published, sent_to_ministry | report_book.status |
| report_book_type | term, year_end | report_book.report_type |
| relationship_type | mother, father, guardian | parent_student_link |

## 3. Tables

### public.school
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | varchar | |
| code | varchar | Short code |
| school_type | enum schooltype | primary or secondary |
| address | varchar | |
| phone | varchar | |
| email | varchar | |
| logo_url | varchar nullable | |
| is_active | boolean default true | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### public.user_profile
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | Same as auth.users.id |
| school_id | uuid FK → school | NULL until onboarding |
| email | varchar | |
| first_name | varchar | |
| last_name | varchar | |
| role | enum role | admin or teacher |
| avatar_url | varchar nullable | |
| is_active | boolean default true | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### public.academic_year
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| school_id | uuid FK → school | |
| name | varchar | e.g. "2025/2026" |
| start_date | date | |
| end_date | date | |
| is_active | boolean | Only one per school |
| grading_model | enum gradingmodel | term_based or year_based |
| year_exam_weight | integer nullable | Only for year_based |
| year_coursework_weight | integer nullable | Only for year_based |
| created_at | timestamptz | |
| updated_at | timestamptz | |

CHECK: `year_exam_weight + year_coursework_weight = 100` when year_based.

### public.student_group
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | varchar | e.g. "Class 3A" |
| academic_year_id | uuid FK → academic_year | |
| created_by | uuid FK → user_profile | Teacher who created it |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### public.term
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| academic_year_id | uuid FK → academic_year | |
| name | enum term_name | michaelmas, hilary, trinity |
| start_date | date | |
| end_date | date | |
| exam_weight | integer | e.g. 60 |
| coursework_weight | integer | e.g. 40 |
| is_ministry_reporting | boolean default false | True for the term sent to ministry |
| sort_order | integer | 1, 2, 3 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

CHECK: `exam_weight + coursework_weight = 100`
UNIQUE: `(academic_year_id, name)`

### public.subject
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| school_id | uuid FK → school | |
| name | varchar | e.g. "Mathematics" |
| code | varchar nullable | e.g. "MATH" |
| is_graded | boolean default true | False for PE, Assembly |
| sort_order | integer default 0 | Display order |
| created_at | timestamptz | |
| updated_at | timestamptz | |

UNIQUE: `(school_id, name)`

### student.student
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| school_id | uuid FK → school | |
| first_name | varchar | |
| last_name | varchar | |
| registration_number | varchar | e.g. "STU-2025-001" |
| gender | enum gender | |
| date_of_birth | date nullable | |
| address | varchar nullable | |
| avatar_url | varchar nullable | |
| is_active | boolean default true | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

UNIQUE: `(school_id, registration_number)`

### student.student_group_enrollment
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| student_id | uuid FK → student | |
| student_group_id | uuid FK → student_group | |
| enrolled_at | timestamptz | |
| created_at | timestamptz | |

UNIQUE: `(student_id, student_group_id)`

### student.student_subject_profile
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| student_id | uuid FK → student | |
| subject_id | uuid FK → subject | |
| academic_year_id | uuid FK → academic_year | |
| created_at | timestamptz | |

UNIQUE: `(student_id, subject_id, academic_year_id)`

### student.parent_student_link
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_profile_id | uuid FK → user_profile | Parent's profile |
| student_id | uuid FK → student | |
| relationship_type | enum relationship_type | mother, father, guardian |
| created_at | timestamptz | |

### grading.assessment
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| term_id | uuid FK → term | |
| subject_id | uuid FK → subject | |
| student_group_id | uuid FK → student_group | |
| title | varchar | e.g. "Mid-term Exam" |
| assessment_type | enum assessment_type | exam or coursework |
| assessment_date | date nullable | |
| max_score | numeric | e.g. 100 |
| weight | numeric default 1 | Relative weight within same type |
| sort_order | integer default 0 | |
| is_excluded | boolean default false | Exclude entire assessment |
| exclusion_reason | varchar nullable | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### grading.grade
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| assessment_id | uuid FK → assessment | |
| student_id | uuid FK → student | |
| score | numeric nullable | Null = not yet graded |
| letter_grade | varchar nullable | |
| remarks | text nullable | |
| is_excluded | boolean default false | Exclude this student's grade |
| exclusion_reason | varchar nullable | |
| created_by | uuid FK → user_profile | |
| updated_by | uuid FK → user_profile | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

UNIQUE: `(assessment_id, student_id)`

### reporting.report_book
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| student_id | uuid FK → student | |
| academic_year_id | uuid FK → academic_year | |
| term_id | uuid FK → term | |
| student_group_id | uuid FK → student_group | |
| report_type | enum report_book_type | term or year_end |
| status | enum report_book_status | draft → published → sent_to_ministry |
| overall_average | numeric nullable | |
| position | integer nullable | Rank in class |
| total_students | integer nullable | Class size |
| class_teacher_remark | text nullable | |
| conduct | varchar nullable | e.g. "Excellent" |
| attendance_percentage | numeric nullable | 0–100 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

UNIQUE: `(student_id, term_id, report_type)`

### reporting.class_report_file
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| student_group_id | uuid FK → student_group | |
| term_id | uuid FK → term | |
| report_type | text | term or year_end |
| file_type | text | pdf, csv, or xlsx |
| file_path | text | Path in Supabase Storage |
| file_size | integer | Size in bytes |
| generated_by | uuid FK → user_profile nullable | |
| generated_at | timestamptz | |

### reporting.report_book_entry
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| report_book_id | uuid FK → report_book | |
| subject_id | uuid FK → subject | |
| coursework_average | numeric nullable | |
| exam_average | numeric nullable | |
| term_composite | numeric nullable | |
| year_grade | numeric nullable | Only for year_end reports |
| letter_grade | varchar nullable | |
| teacher_remark | text nullable | Subject teacher's comment |
| sort_order | integer default 0 | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### reporting.report_book_pdf
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| report_book_id | uuid FK → report_book | |
| file_path | text | Path in Supabase Storage |
| file_size | int4 | Size in bytes |
| generated_by | uuid FK → user_profile | |
| generated_at | timestamptz | |

### staff.teacher_group_assignment
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_profile_id | uuid FK → user_profile | |
| student_group_id | uuid FK → student_group | |
| academic_year_id | uuid FK → academic_year | |
| is_class_teacher | boolean | Drives entire permission model |
| created_at | timestamptz | |

### staff.teacher_subject_assignment
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_profile_id | uuid FK → user_profile | |
| subject_id | uuid FK → subject | |
| student_group_id | uuid FK → student_group | |
| academic_year_id | uuid FK → academic_year | |
| created_at | timestamptz | |

---

# PART B -Security

## 4. Security Architecture

Three layers:

| Layer | What it does | Count |
|---|---|---|
| RLS school isolation | Every table scoped by school_id. Prevents cross-school data leakage. | 16 policies |
| RLS assignment scoping | Teachers see only assigned groups/subjects. Class teacher reads all, writes own. | 12 policies |
| NestJS guards | Workflow permissions: class teacher write ops, ministry lock, role checks. | 3 guards |

## 5. RLS Helper Functions

```sql
-- Returns current user's school_id
get_user_school_id() RETURNS uuid

-- Returns true if role = 'admin' and is_active = true
is_admin() RETURNS boolean

-- Returns true if teacher has any assignment to the group
is_assigned_to_group(p_group_id uuid) RETURNS boolean

-- Returns true if teacher teaches the subject in the group
is_assigned_to_subject_in_group(p_subject_id uuid, p_group_id uuid) RETURNS boolean
```

All use `SECURITY DEFINER STABLE`.

## 6. RLS Policies -School Isolation (16 policies)

Every table gets one `school_isolation` policy (`FOR ALL`):

| Table | How it resolves school_id |
|---|---|
| public.school | `id = get_user_school_id()` |
| public.user_profile | `school_id = get_user_school_id()` |
| public.academic_year | `school_id = get_user_school_id()` |
| public.subject | `school_id = get_user_school_id()` |
| student.student | `school_id = get_user_school_id()` |
| public.student_group | → `academic_year.school_id` |
| public.term | → `academic_year.school_id` |
| staff.teacher_group_assignment | → `academic_year.school_id` |
| staff.teacher_subject_assignment | → `academic_year.school_id` |
| student.student_subject_profile | → `academic_year.school_id` |
| student.student_group_enrollment | → `student_group → academic_year.school_id` |
| student.parent_student_link | → `student.school_id` |
| grading.assessment | → `term → academic_year.school_id` |
| grading.grade | → `assessment → term → academic_year.school_id` |
| reporting.report_book | → `academic_year.school_id` |
| reporting.report_book_entry | → `report_book → academic_year.school_id` |

## 7. RLS Policies -Assignment Scoping (12 policies)

### Student tables (4 policies, `FOR SELECT`)
Teachers see only students in their assigned groups. Admin sees all.

| Table | Check |
|---|---|
| student.student | `is_admin() OR is_assigned_to_group(enrollment.student_group_id)` |
| student.student_group_enrollment | `is_admin() OR is_assigned_to_group(student_group_id)` |
| student.student_subject_profile | `is_admin() OR is_assigned_to_group(enrollment.student_group_id)` |
| student.parent_student_link | `is_admin() OR self OR is_assigned_to_group(enrollment.student_group_id)` |

### Grading tables -split READ / WRITE (6 policies)

This is the most critical part. Subject teacher sees/edits own subject. Class teacher reads ALL subjects (for reports) but cannot edit other teachers' grades.

**grading.assessment:**

| Policy | Operation | Who |
|---|---|---|
| `assignment_read` | SELECT | Admin OR subject teacher (via teacher_subject_assignment) OR class teacher (via is_class_teacher = true) |
| `assignment_write` | INSERT | Admin OR subject teacher only |
| `assignment_update` | UPDATE | Admin OR subject teacher only |

**grading.grade:**

| Policy | Operation | Who |
|---|---|---|
| `assignment_read` | SELECT | Admin OR subject teacher OR class teacher (sees ALL grades for students in their group) |
| `assignment_write` | INSERT | Admin OR subject teacher only |
| `assignment_update` | UPDATE | Admin OR subject teacher only |

The class teacher READ path on grade:
```sql
OR EXISTS (
  SELECT 1 FROM student.student_group_enrollment sge
  JOIN staff.teacher_group_assignment tga
    ON tga.student_group_id = sge.student_group_id
    AND tga.is_class_teacher = true
  WHERE tga.user_profile_id = auth.uid()
  AND sge.student_id = grade.student_id
)
```

### Reporting tables (2 policies, `FOR SELECT`)

| Table | Check |
|---|---|
| reporting.report_book | `is_admin() OR is_assigned_to_group(enrollment.student_group_id)` |
| reporting.report_book_entry | `is_admin() OR is_assigned_to_group(enrollment.student_group_id)` |

## 8. NestJS Guards

| Guard | What it checks | Used on |
|---|---|---|
| AuthGuard | Validates Supabase JWT. Attaches `request.user = { id, email }` | All protected endpoints |
| ClassTeacherGuard | `teacher_group_assignment.is_class_teacher = true`. Admin bypasses. | Enrollment, reports, teacher management, class updates |
| ReportGuard | `report_book.status !== 'sent_to_ministry'`. Blocks edits on locked reports. | Report updates, entry edits, regenerate, publish |

## 9. Supabase Clients

| Client | When to use | RLS |
|---|---|---|
| `serviceClient` (service role key) | Auth operations, class creation, enrollment, report generation, guard queries | BYPASSES |
| `createUserClient` (user JWT) | Grade entry/read, assessment CRUD, report reading -any query where RLS should enforce subject+group | RESPECTS |

Rule: If the endpoint involves grading data, use the user client. For everything else, use serviceClient with NestJS guards.

## 10. Schema Grants

Custom schemas need explicit grants (Supabase only auto-grants `public`):

```sql
GRANT USAGE ON SCHEMA student TO service_role, authenticated, anon;
GRANT USAGE ON SCHEMA grading TO service_role, authenticated, anon;
GRANT USAGE ON SCHEMA reporting TO service_role, authenticated, anon;
GRANT USAGE ON SCHEMA staff TO service_role, authenticated, anon;

GRANT ALL ON ALL TABLES IN SCHEMA student TO service_role, authenticated, anon;
GRANT ALL ON ALL TABLES IN SCHEMA grading TO service_role, authenticated, anon;
GRANT ALL ON ALL TABLES IN SCHEMA reporting TO service_role, authenticated, anon;
GRANT ALL ON ALL TABLES IN SCHEMA staff TO service_role, authenticated, anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA student GRANT ALL ON TABLES TO service_role, authenticated, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA grading GRANT ALL ON TABLES TO service_role, authenticated, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT ALL ON TABLES TO service_role, authenticated, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA staff GRANT ALL ON TABLES TO service_role, authenticated, anon;
```

---

# PART C -Backend Modules

## 11. Build Order

```
 1. Auth              -OTP login, JWT validation
 2. Academic Year     -create, activate, grading model
 3. Subject           -school-level CRUD
 4. Term              -3 terms per year, weights
 5. Student           -school-level CRUD
 6. Class             -student groups, teacher assignment
 7. Enrollment        -enroll students, assign subjects
 8. Grading           -assessments, grades, bulk entry, exclusions
 9. Calculation       -weighted averages, rankings
10. Reporting         -report books, remarks, PDF, status flow
11. Cache             -pluggable caching (memory or Redis)
```

## 12. Project Structure

```
backend/src/
├── main.ts
├── app.module.ts
├── supabase/
│   └── supabase.service.ts
├── types/
│   ├── database.types.ts          ← auto-generated
│   └── helpers.ts                 ← Row/Insert/Update/Enum types
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── auth.guard.ts
│   └── dto/
│       ├── send-otp.dto.ts
│       ├── verify-otp.dto.ts
│       └── refresh-token.dto.ts
├── academic-year/
│   ├── academic-year.module.ts
│   ├── academic-year.controller.ts
│   ├── academic-year.service.ts
│   └── dto/
│       ├── create-academic-year.dto.ts
│       └── update-academic-year.dto.ts
├── subject/
│   ├── subject.module.ts
│   ├── subject.controller.ts
│   ├── subject.service.ts
│   └── dto/
│       ├── create-subject.dto.ts
│       ├── update-subject.dto.ts
│       └── reorder-subjects.dto.ts
├── term/
│   ├── term.module.ts
│   ├── term.controller.ts
│   ├── term.service.ts
│   └── dto/
│       ├── create-term.dto.ts
│       └── update-term.dto.ts
├── student/
│   ├── student.module.ts
│   ├── student.controller.ts
│   ├── student.service.ts
│   └── dto/
│       ├── create-student.dto.ts
│       └── update-student.dto.ts
├── class/
│   ├── class.module.ts
│   ├── class.controller.ts
│   ├── class.service.ts
│   ├── class-teacher.guard.ts
│   └── dto/
│       ├── create-class.dto.ts
│       ├── update-class.dto.ts
│       └── add-teacher.dto.ts
├── enrollment/
│   ├── enrollment.module.ts
│   ├── enrollment.controller.ts
│   ├── enrollment.service.ts
│   └── dto/
│       ├── enroll-student.dto.ts
│       ├── bulk-enroll.dto.ts
│       ├── assign-subjects.dto.ts
│       └── bulk-assign-subjects.dto.ts
├── grading/
│   ├── grading.module.ts
│   ├── assessment.controller.ts
│   ├── grade.controller.ts
│   ├── assessment.service.ts
│   ├── grade.service.ts
│   └── dto/
│       ├── create-assessment.dto.ts
│       ├── update-assessment.dto.ts
│       ├── create-grade.dto.ts
│       ├── update-grade.dto.ts
│       ├── bulk-grade.dto.ts
│       └── exclude.dto.ts
├── calculation/
│   ├── calculation.module.ts
│   ├── calculation.controller.ts
│   ├── calculation.service.ts
│   └── interfaces/
│       └── calculation.interfaces.ts
├── reporting/
│   ├── reporting.module.ts
│   ├── report.controller.ts
│   ├── report.service.ts
│   ├── report.guard.ts
│   └── dto/
│       ├── generate-report.dto.ts
│       ├── update-report.dto.ts
│       ├── update-report-entry.dto.ts
│       └── save-pdf.dto.ts
└── cache/
    ├── cache.module.ts
    └── cache.service.ts
```

---

# PART D -API Routes

## 13. Auth

| Method | Route | Guards | Description |
|---|---|---|---|
| POST | `/auth/otp/send` | Public | Send OTP to email. shouldCreateUser: true |
| POST | `/auth/otp/verify` | Public | Verify OTP → JWT session + user profile |
| GET | `/auth/me` | Auth | Get current user profile with school |
| POST | `/auth/refresh` | Public | Refresh expired access token |
| POST | `/auth/logout` | Auth | Sign out |

New teacher: OTP → auth.users created → `handle_new_user()` trigger creates user_profile (school_id = null) → frontend redirects to onboarding.

## 14. Academic Year

| Method | Route | Guards | Description |
|---|---|---|---|
| GET | `/academic-years` | Auth | List years for teacher's school |
| GET | `/academic-years/active` | Auth | Get currently active year |
| GET | `/academic-years/:id` | Auth | Get year details |
| POST | `/academic-years` | Auth | Create year (any teacher) |
| PATCH | `/academic-years/:id` | Auth | Update year |
| PATCH | `/academic-years/:id/activate` | Auth | Deactivate others, activate this one |

## 15. Subject

| Method | Route | Guards | Description |
|---|---|---|---|
| GET | `/subjects` | Auth | List subjects for teacher's school |
| GET | `/subjects/:id` | Auth | Get subject details |
| POST | `/subjects` | Auth | Create subject (any teacher) |
| PATCH | `/subjects/reorder` | Auth | Batch update sort_order for multiple subjects |
| PATCH | `/subjects/:id` | Auth | Update subject |
| DELETE | `/subjects/:id` | Auth | Delete (blocked if grades exist) |

## 16. Term

| Method | Route | Guards | Description |
|---|---|---|---|
| GET | `/terms?yearId=` | Auth | List terms for a year |
| GET | `/terms/:id` | Auth | Get term details |
| POST | `/terms` | Auth | Create term (auto sort_order) |
| PATCH | `/terms/:id` | Auth | Update weights/dates |
| DELETE | `/terms/:id` | Auth | Delete (blocked if assessments exist) |

## 17. Student

| Method | Route | Guards | Description |
|---|---|---|---|
| GET | `/students?search=` | Auth | List students, optional search |
| GET | `/students/:id` | Auth | Get student details |
| POST | `/students` | Auth | Create student (school_id from profile) |
| PATCH | `/students/:id` | Auth | Update student |

## 18. Class (Student Group)

| Method | Route | Guards | Description |
|---|---|---|---|
| GET | `/classes` | Auth | List teacher's assigned classes |
| POST | `/classes` | Auth | Create class (auto-assigns is_class_teacher = true) |
| GET | `/classes/:classId` | Auth | Get class details |
| PATCH | `/classes/:classId` | Auth + CT | Update class name |
| DELETE | `/classes/:classId` | Auth + CT | Delete class |
| GET | `/classes/:classId/teachers` | Auth | List teachers + subjects |
| POST | `/classes/:classId/teachers` | Auth + CT | Add teacher (is_class_teacher = false) |
| DELETE | `/classes/:classId/teachers/:teacherId` | Auth + CT | Remove teacher |

Creating a class auto-assigns:
1. `teacher_group_assignment` with `is_class_teacher = true`
2. `teacher_subject_assignment` × N subjects (if provided)

## 19. Enrollment

All endpoints: Auth + ClassTeacherGuard.

| Method | Route | Description |
|---|---|---|
| GET | `/classes/:classId/students` | List enrolled students |
| POST | `/classes/:classId/enroll` | Enroll one student |
| POST | `/classes/:classId/enroll/bulk` | Bulk enroll |
| DELETE | `/classes/:classId/enroll/:studentId` | Unenroll (removes subject assignments too) |
| GET | `/classes/:classId/students/:studentId/subjects` | List student's subjects |
| POST | `/classes/:classId/subjects` | Assign subjects to one student |
| POST | `/classes/:classId/subjects/bulk` | Bulk assign subjects to multiple students |
| DELETE | `/classes/:classId/students/:studentId/subjects/:subjectId` | Remove subject |

## 20. Grading

All endpoints: Auth only. RLS handles subject+group enforcement via user client.

### Assessments

| Method | Route | Description |
|---|---|---|
| GET | `/assessments?termId=&subjectId=&studentGroupId=` | List assessments |
| GET | `/assessments/:id` | Get assessment |
| POST | `/assessments` | Create (RLS checks subject assignment) |
| PATCH | `/assessments/:id` | Update |
| PATCH | `/assessments/:id/exclude` | Exclude entire assessment |
| DELETE | `/assessments/:id` | Delete + cascade grades |

### Grades

| Method | Route | Description |
|---|---|---|
| GET | `/grades?assessmentId=` | Grades for one assessment |
| GET | `/grades/by-term?termId=&subjectId=&studentGroupId=` | All grades for subject in term |
| POST | `/grades` | Enter a grade |
| POST | `/grades/bulk` | Bulk upsert (update existing, insert new) |
| PATCH | `/grades/:id` | Update score/remarks |
| PATCH | `/grades/:id/exclude` | Exclude single grade |

## 21. Calculation

| Method | Route | Guards | Description |
|---|---|---|---|
| GET | `/calculations/student-term?studentId=&termId=&studentGroupId=` | Auth | One student, one term |
| GET | `/calculations/student-year?studentId=&academicYearId=&studentGroupId=` | Auth | One student, full year |
| GET | `/calculations/class-term?termId=&studentGroupId=` | Auth | All students + rankings |
| GET | `/calculations/class-year?academicYearId=&studentGroupId=` | Auth | All students year results |
| GET | `/calculations/class-summary?termId=&studentGroupId=` | Auth | Student × subject grid |

## 22. Reporting

| Method | Route | Guards | Description |
|---|---|---|---|
| POST | `/reports/generate` | Auth + CT | Generate reports for class |
| GET | `/reports?studentGroupId=&termId=&reportType=` | Auth + CT | List reports |
| GET | `/reports/student?studentId=&termId=&reportType=` | Auth + CT | Specific student's report |
| GET | `/reports/:id` | Auth + CT | Full report with entries + PDFs |
| PATCH | `/reports/:id` | Auth + CT + RG | Update remark, conduct, attendance |
| PATCH | `/reports/:id/regenerate` | Auth + CT + RG | Recalculate, keep remarks |
| PATCH | `/reports/:id/publish` | Auth + CT + RG | draft → published |
| PATCH | `/reports/:id/send-to-ministry` | Auth + CT | published → sent_to_ministry |
| PATCH | `/report-entries/:entryId` | Auth + RG | Subject teacher adds remark/letter grade |
| POST | `/reports/:id/pdf` | Auth + CT + RG | Save PDF record |
| POST | `/reports/:id/pdf/upload` | Auth + CT + RG | Upload PDF to Supabase Storage |
| GET | `/reports/:id/pdfs` | Auth + CT | PDF version history |
| GET | `/reports/:id/pdf/latest` | Auth + CT | Most recent PDF |
| GET | `/reports/:id/pdf/:pdfId/download` | Auth + CT | Download PDF file |
| GET | `/reports/class-summary?studentGroupId=&termId=&reportType=` | Auth + CT | Class summary from persisted reports |
| POST | `/reports/class-summary/upload` | Auth + CT | Upload class summary file (PDF/CSV/XLSX) |
| GET | `/reports/class-summary/download?studentGroupId=&termId=&reportType=&fileType=` | Auth + CT | Download stored class summary file |
| GET | `/reports/class-summary/files?studentGroupId=&termId=&reportType=` | Auth + CT | List stored class summary files |

CT = ClassTeacherGuard, RG = ReportGuard

---

# PART E -Grading Calculation

## 23. Term Grade Calculation

For each student, for each subject, for each term:

```
Step 1: Collect coursework grades (non-excluded)
  Normalize to percentages: (score / max_score) × 100
  Calculate weighted average using assessment weights

Step 2: Collect exam grades (non-excluded)
  Same normalization and weighting

Step 3: Apply term weights
  term_composite = (coursework_avg × coursework_weight%) + (exam_avg × exam_weight%)

Step 4: Overall average
  average of all graded subjects' term_composites
```

### Worked example

```
Term: Michaelmas (exam_weight: 60, coursework_weight: 40)

Maths coursework:
  Homework 1: 35/50 (70%) weight 1
  Homework 2: 40/50 (80%) weight 1
  Class Test:  28/40 (70%) weight 2
  coursework_avg = (70×1 + 80×1 + 70×2) / (1+1+2) = 72.5%

Maths exam:
  Mid-term: 78/100 (78%) weight 1
  exam_avg = 78.0%

term_composite = (72.5 × 40%) + (78.0 × 60%) = 29.0 + 46.8 = 75.8%
```

## 24. Year-End Calculation -TERM_BASED

```
Year grade = simple average of 3 term composites

Maths:
  Michaelmas: 75.8
  Hilary:     80.2
  Trinity:    72.0
  year_grade = (75.8 + 80.2 + 72.0) / 3 = 76.0

Ministry receives: Trinity term report (is_ministry_reporting = true)
```

## 25. Year-End Calculation -YEAR_BASED

```
Year grade = terms_avg × year_coursework_weight% + yr_exam × year_exam_weight%

Where:
  terms_avg = (T1 composite + T2 composite + T3 composite) / 3
  yr_exam = Trinity term's EXAM average (end of year exam)

Example (year_coursework_weight: 40, year_exam_weight: 60):

Maths:
  terms_avg = (75.8 + 80.2 + 72.0) / 3 = 76.0
  yr_exam = Trinity exam_average = 82.0

  year_grade = (76.0 × 40%) + (82.0 × 60%) = 30.4 + 49.2 = 79.6

Ministry receives: Year-end report
```

## 26. Handling Edge Cases

| Case | Behaviour |
|---|---|
| Assessment excluded (`is_excluded = true`) | All students' grades for that assessment skipped |
| Grade excluded (`grade.is_excluded = true`) | Only that student's grade skipped |
| Only coursework, no exams | `term_composite = coursework_avg` (exam weight ignored) |
| Only exams, no coursework | `term_composite = exam_avg` |
| No grades at all for a subject | `term_composite = null`, not included in overall |
| Weight is relative, not absolute | Weights don't need to sum to 100. Weighted average formula handles it. |

---

# PART F -Reporting

## 27. Report Status Flow

```
draft → published → sent_to_ministry

draft:            Teachers adding remarks. Can edit, regenerate.
published:        Parents can view. Teachers can still edit remarks.
sent_to_ministry: LOCKED FOREVER. No edits. No regenerate.
```

## 28. Which Report Goes to Ministry

| Grading Model | Report Sent | Why |
|---|---|---|
| TERM_BASED | Trinity term report (type: 'term') | Primary schools report per term |
| YEAR_BASED | Year-end report (type: 'year_end') | Secondary schools report annually |

## 29. Report Card PDF -Term

Portrait A4. One per student.

```
[School Logo]
SCHOOL NAME
School Address

STUDENT REPORT CARD -Michaelmas Term 2025/2026

Name: James Thompson          Reg: STU-2025-001
Class: 3A                     Gender: Male
DOB: 15/03/2015               Position: 3rd out of 30

┌────────────────┬──────┬──────┬───────┬───────┬─────────────┐
│ Subject        │ C/W  │ Exam │ Total │ Grade │ Remark      │
├────────────────┼──────┼──────┼───────┼───────┼─────────────┤
│ Mathematics    │ 72.5 │ 78.0 │ 75.8  │ B+    │ Good effort │
│ English Lang.  │ 80.0 │ 85.0 │ 83.0  │ A-    │ Excellent   │
│ PE             │  -  │  -  │  -   │  -   │ Very active │
├────────────────┼──────┼──────┼───────┼───────┼─────────────┤
│ OVERALL        │      │      │ 75.1  │ B+    │             │
└────────────────┴──────┴──────┴───────┴───────┴─────────────┘

CLASS TEACHER'S REMARK:
James has shown consistent effort...

Class Teacher: Mrs. Mary Johnson        Date: 15 Dec 2025
Signature: ___________________
```

## 30. Report Card PDF -Year-End TERM_BASED

```
┌────────────────┬───────┬───────┬───────┬───────┬───────┐
│ Subject        │  T1   │  T2   │  T3   │ Year  │ Grade │
├────────────────┼───────┼───────┼───────┼───────┼───────┤
│ Mathematics    │ 75.8  │ 80.2  │ 72.0  │ 76.0  │ B+    │
│ English Lang.  │ 83.0  │ 79.5  │ 85.0  │ 82.5  │ A-    │
└────────────────┴───────┴───────┴───────┴───────┴───────┘

Year = (T1 + T2 + T3) / 3
```

## 31. Report Card PDF -Year-End YEAR_BASED

Different table -two extra columns for Terms Avg and Yr Exam:

```
┌────────────────┬──────┬──────┬──────┬───────────┬──────────┬───────┬───────┐
│ Subject        │  T1  │  T2  │  T3  │ Terms Avg │ Yr Exam  │ Year  │ Grade │
│                │      │      │      │   (40%)   │  (60%)   │       │       │
├────────────────┼──────┼──────┼──────┼───────────┼──────────┼───────┼───────┤
│ Mathematics    │ 75.8 │ 80.2 │ 72.0 │   76.0    │   82.0   │ 79.6  │ B+    │
│ English Lang.  │ 83.0 │ 79.5 │ 85.0 │   82.5    │   88.0   │ 85.8  │ A-    │
└────────────────┴──────┴──────┴──────┴───────────┴──────────┴───────┴───────┘

Terms Avg = (T1 + T2 + T3) / 3
Yr Exam = Trinity term exam average
Year = Terms Avg × 40% + Yr Exam × 60%
```

The frontend checks `academic_year.grading_model` to pick the right layout.

## 32. Class Summary Sheet

Landscape A4. All students × all graded subjects:

```
CLASS SUMMARY -Class 3A -Michaelmas Term 2025/2026

┌────┬──────────────────┬───────┬───────┬───────┬───────┬─────┐
│ #  │ Student          │ Maths │ Eng   │ Sci   │ Art   │ Avg │
├────┼──────────────────┼───────┼───────┼───────┼───────┼─────┤
│ 1  │ Davis, Emily     │ 90.0  │ 88.0  │ 85.0  │ 90.0  │83.3│
│ 2  │ Thompson, James  │ 75.8  │ 83.0  │ 68.0  │ 88.0  │75.1│
│ 3  │ Williams, Sarah  │ 82.0  │ 76.5  │ 90.5  │ 75.0  │79.3│
│ ...│ ...              │ ...   │ ...   │ ...   │ ...   │ ... │
├────┼──────────────────┼───────┼───────┼───────┼───────┼─────┤
│    │ CLASS AVERAGE    │ 74.2  │ 76.8  │ 72.1  │ 81.2  │74.0│
│    │ HIGHEST          │ 90.0  │ 88.0  │ 90.5  │ 90.0  │83.3│
│    │ LOWEST           │ 55.0  │ 60.0  │ 58.0  │ 70.0  │59.2│
└────┴──────────────────┴───────┴───────┴───────┴───────┴─────┘

Ranked by overall average. Non-graded subjects (PE) excluded from grid.
```

## 33. Grading Scale

| Score | Grade | Description |
|---|---|---|
| 90 -100 | A | Excellent |
| 85 -89 | A- | Very Good |
| 80 -84 | B+ | Good |
| 75 -79 | B | Above Average |
| 70 -74 | B- | Average |
| 65 -69 | C+ | Below Average |
| 60 -64 | C | Fair |
| 55 -59 | C- | Needs Improvement |
| 50 -54 | D | Poor |
| 0 -49 | F | Fail |

Use teacher's manual `letter_grade` if entered. Otherwise compute from score.

## 34. PDF Generation Flow

```
Frontend generates PDF → uploads to Supabase Storage → saves record via API

1. GET /reports/:id                          → fetch all report data
2. Render PDF (jsPDF or @react-pdf)          → client-side
3. supabase.storage.upload(path, blob)       → upload to Storage
4. POST /reports/:id/pdf { filePath, size }  → save record in report_book_pdf
```

File naming:
```
report-cards/{year}/{term}/{student-reg}.pdf
report-cards/2025-2026/michaelmas/STU-2025-001.pdf
report-cards/2025-2026/year-end/class-3a-summary.pdf
```

---

# PART G -Teacher Workflow

## 35. Class Teacher Flow

```
1. Create class "Class 3A" for 2025/2026
   → auto-assigns as class teacher + subject assignments

2. Enroll 30 students
   → POST /classes/:id/enroll/bulk

3. Bulk assign core subjects to all students
   → POST /classes/:id/subjects/bulk

4. Add subject teachers (optional)
   → POST /classes/:id/teachers { teacherId, subjectIds }
   → Added teacher gets is_class_teacher = false

5. Enter grades throughout the term
   → POST /grades/bulk (for their own subjects)

6. Generate reports at end of term
   → POST /reports/generate

7. Add class teacher remark per student
   → PATCH /reports/:id

8. Publish reports
   → PATCH /reports/:id/publish

9. Generate PDFs
   → Frontend renders + uploads

10. Send to ministry (Trinity term or year-end)
    → PATCH /reports/:id/send-to-ministry
```

## 36. Subject Teacher Flow

```
1. Gets added to a class by the class teacher
   → is_class_teacher = false

2. Can see students enrolled in that class
   → RLS assignment_isolation filters

3. Creates assessments for their subject
   → POST /assessments

4. Enters grades for their subject only
   → POST /grades/bulk
   → RLS blocks if wrong subject

5. Adds teacher remark on report entries for their subject
   → PATCH /report-entries/:id

6. Cannot: enroll students, generate reports, add teachers,
   edit other teachers' grades, change class name
```

## 37. Permission Matrix

| Action | Class Teacher | Subject Teacher | Admin |
|---|---|---|---|
| Create class | Yes (auto-assigns) | No (added by CT) | Yes |
| Enroll students | Yes | No | Yes |
| Assign subjects | Yes | No | Yes |
| Add teachers | Yes | No | Yes |
| Read all grades in group | Yes (RLS) | Own subject only (RLS) | Yes |
| Write grades | Own subjects only (RLS) | Own subject only (RLS) | Yes |
| Create assessments | Own subjects only (RLS) | Own subject only (RLS) | Yes |
| Generate reports | Yes (guard) | No (guard blocks) | Yes |
| Add class teacher remark | Yes (guard) | No (guard blocks) | Yes |
| Add subject remark | Yes (any subject) | Own subject only (RLS) | Yes |
| Publish reports | Yes (guard) | No (guard blocks) | Yes |
| Send to ministry | Yes (guard) | No (guard blocks) | Yes |