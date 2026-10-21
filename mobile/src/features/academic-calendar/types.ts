/**
 * Local types for the Academic Calendar feature — mirrors the web app's
 * `app/dashboard/academic-calendar/_components/types.ts`. Defined here rather
 * than in `@/lib/types` because the shared shapes there omit the grading /
 * weight / ministry fields this screen needs.
 */

export type GradingModel =
  | "weighted_continuous"
  | "weighted_cumulative"
  | "continuous_cumulative";

/** Human labels, copied from the web `GRADING_MODEL_LABELS`. */
export const GRADING_MODEL_LABELS: Record<GradingModel, string> = {
  weighted_continuous: "Weighted Continuous Assessment",
  weighted_cumulative: "Weighted Cumulative",
  continuous_cumulative: "Continuous Cumulative",
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

const LEGACY_TERM_LABELS: Record<string, string> = {
  michaelmas: "Michaelmas",
  hilary: "Hilary",
  trinity: "Trinity",
};

/** Display name for a term. Old rows hold lowercase enum slugs. */
export function termLabel(name: string): string {
  return LEGACY_TERM_LABELS[name] ?? name;
}

/** Grading-model option list for the `Select`, in catalog order. */
export const GRADING_MODEL_OPTIONS: { value: GradingModel; label: string }[] =
  (Object.keys(GRADING_MODEL_LABELS) as GradingModel[]).map((value) => ({
    value,
    label: GRADING_MODEL_LABELS[value],
  }));

/** Label for a grading model, falling back to a title-cased slug. */
export function gradingModelLabel(model: string): string {
  if (model in GRADING_MODEL_LABELS) {
    return GRADING_MODEL_LABELS[model as GradingModel];
  }
  return model.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Active years first, then most-recent start date. */
export function sortYearsActiveFirst(years: AcademicYear[]): AcademicYear[] {
  return [...years].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return new Date(b.start_date).getTime() - new Date(a.start_date).getTime();
  });
}
