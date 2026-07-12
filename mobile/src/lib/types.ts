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
