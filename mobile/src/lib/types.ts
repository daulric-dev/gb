/** Shared API response shapes, mirrored from the web frontend. */

/** GET /courses - the fields the mobile app reads. */
export interface CourseSummary {
  id: string;
  name: string;
  code: string | null;
  status: "draft" | "published" | "archived";
  studentCount?: number;
}

export interface AcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
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

export interface Term {
  id: string;
  name: string;
  academic_year_id: string;
}
