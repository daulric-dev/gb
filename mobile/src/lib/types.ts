/** Shared API response shapes, mirrored from the web frontend. */

export interface ClassItem {
  id: string;
  name: string | null;
  academicYearId: string | null;
  isClassTeacher: boolean | null;
  createdAt?: string;
}

export interface AcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  grading_model: string;
  is_active?: boolean;
}

export interface SchoolMember {
  id: string;
  role: "admin" | "teacher" | "member";
}

export interface SchoolStudent {
  id: string;
  gender: "male" | "female" | null;
  is_active: boolean;
}

export interface JoinRequest {
  id: string;
}

export interface Student {
  id: string;
  school_id: string;
  first_name: string;
  last_name: string;
  gender: "male" | "female" | null;
  date_of_birth: string | null;
  enrollement_date: string | null;
  is_active: boolean;
}

/* ------------------------------------------------------------------ */
/* Class detail: grading + attendance (mirrors the web class subtree)  */
/* ------------------------------------------------------------------ */

/** Full class-info shape returned by GET /classes. */
export interface ClassInfo {
  id: string;
  name: string;
  academicYearId: string;
  isClassTeacher: boolean;
}

export interface Term {
  id: string;
  name: string;
  academic_year_id: string;
}

export interface Subject {
  id: string;
  name: string;
  code: string | null;
}

export interface Assessment {
  id: string;
  term_id: string;
  subject_id: string;
  title: string;
  assessment_type: "exam" | "coursework";
  assessment_date: string | null;
  max_score: number;
  weight: number;
  sort_order: number;
  is_excluded: boolean;
  exclusion_reason: string | null;
}

export interface ConvertedGrade {
  label: string;
  gpaPoints: number | null;
  isPass: boolean;
}

export interface GradeRow {
  id: string;
  assessment_id: string;
  student_id: string;
  score: number | null;
  letter_grade: string | null;
  remarks: string | null;
  is_excluded: boolean;
  exclusion_reason: string | null;
  student: { id: string; first_name: string; last_name: string } | null;
  converted: ConvertedGrade | null;
}

/** A student enrolled in a class (GET /classes/:id/students). */
export interface EnrolledStudent {
  id: string;
  student: { id: string; first_name: string; last_name: string };
}

export type AttendanceStatus = "present" | "absent" | "late";

export interface AttendanceRosterEntry {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  record: {
    id: string;
    status: AttendanceStatus;
    notes: string | null;
  } | null;
}

export interface AttendanceRosterResponse {
  date: string;
  classId: string;
  entries: AttendanceRosterEntry[];
}
