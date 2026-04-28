export interface ClassInfo {
  id: string;
  name: string;
  academicYearId: string;
  isClassTeacher: boolean;
}

export interface Term {
  id: string;
  name: string;
  sort_order: number;
}

export interface StudentRow {
  studentId: string;
  firstName: string;
  lastName: string;
  overallAverage: number | null;
  position: number | undefined;
}
