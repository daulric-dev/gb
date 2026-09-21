export interface Student {
  id: string;
  school_id: string;
  first_name: string;
  last_name: string;
  gender: "male" | "female" | null;
  date_of_birth: string | null;
  enrollment_date: string | null;
  is_active: boolean;
  /** Set once a student redeems a claim code and links a login. */
  user_profile_id: string | null;
}

export interface StudentProfile {
  student: Student;
  /** Current year first, then previous years newest to oldest. */
  classes: {
    id: string;
    name: string;
    enrolledAt: string | null;
    academicYear: { id: string; name: string; isActive: boolean } | null;
  }[];
  /** The subjects taken in the year the student is currently in. */
  subjects: {
    id: string;
    name: string;
    code: string | null;
    isGraded: boolean;
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
