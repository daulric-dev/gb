export type GradingModel =
  | "weighted_continuous"
  | "weighted_cumulative"
  | "continuous_cumulative";

export const GRADING_MODEL_LABELS: Record<GradingModel, string> = {
  weighted_continuous: "Weighted Continuous Assessment",
  weighted_cumulative: "Weighted Cumulative",
  continuous_cumulative: "Continuous-Cumulative",
};

export interface AcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  grading_model: GradingModel;
  is_active: boolean;
  year_exam_weight: number | null;
  year_coursework_weight: number | null;
}

export interface Term {
  id: string;
  academic_year_id: string;
  /** Free text, e.g. "Term 1" or "Fall". */
  name: string;
  start_date: string;
  end_date: string;
  exam_weight: number;
  coursework_weight: number;
  is_ministry_reporting: boolean;
  sort_order: number;
}

export const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const LEGACY_TERM_LABELS: Record<string, string> = {
  michaelmas: "Michaelmas",
  hilary: "Hilary",
  trinity: "Trinity",
};

/** Display name for a term. Old rows hold lowercase enum slugs. */
export function termLabel(name: string): string {
  return LEGACY_TERM_LABELS[name] ?? name;
}

export function sortYearsActiveFirst(years: AcademicYear[]): AcademicYear[] {
  return [...years].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return (
      new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
    );
  });
}
