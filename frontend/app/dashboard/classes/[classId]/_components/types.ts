export interface EnrolledStudent {
  id: string;
  enrolled_at: string;
  student: {
    id: string;
    first_name: string;
    last_name: string;
    gender: string;
    date_of_birth: string | null;
    is_active: boolean;
  };
  subjects?: { id: string; name: string; code: string }[];
}

export interface Subject {
  id: string;
  name: string;
  code: string;
  is_graded: boolean;
  sort_order: number;
}

export interface TeacherAssignment {
  teacherId: string;
  firstName: string | null;
  lastName: string | null;
  isClassTeacher: boolean;
  subjects: { id: string; name: string; code: string }[];
}

export const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
