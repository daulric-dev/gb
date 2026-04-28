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
  coursework_weight: number;
  exam_weight: number;
}
