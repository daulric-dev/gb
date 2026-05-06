export interface AcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  grading_model: "term_based" | "year_based";
  is_active: boolean;
  year_exam_weight: number | null;
  year_coursework_weight: number | null;
}
