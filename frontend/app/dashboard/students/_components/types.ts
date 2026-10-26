export interface Student {
  id: string;
  school_id: string;
  first_name: string;
  last_name: string;
  gender: "male" | "female" | null;
  date_of_birth: string | null;
  enrollment_date: string | null;
  is_active: boolean;
  /** The login linked to this record (set when the student joins). */
  user_profile_id: string | null;
}

export interface StudentProfile {
  student: Student;
  /** Active enrolments first, then completed, then dropped; by name. */
  courses: {
    id: string;
    name: string;
    code: string | null;
    status: "draft" | "published" | "archived";
    termId: string | null;
    academicYearId: string | null;
    enrollmentStatus: "active" | "completed" | "dropped";
    enrolledAt: string | null;
  }[];
  account: {
    id: string;
    email: string | null;
    name: string;
    isActive: boolean;
    accountType: string;
  } | null;
  guardians: {
    id: string;
    name: string;
    email: string | null;
    relationship: string | null;
  }[];
}

export const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
