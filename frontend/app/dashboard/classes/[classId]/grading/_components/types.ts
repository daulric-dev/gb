export const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export interface Term {
  id: string;
  name: string;
  academic_year_id: string;
}

export interface Subject {
  id: string;
  name: string;
  code: string;
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

export interface AcademicYear {
  id: string;
  name: string;
  is_active: boolean;
}

export interface ClassInfo {
  id: string;
  name: string;
  academicYearId: string;
  isClassTeacher: boolean;
}
