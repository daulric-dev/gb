/**
 * Frontend grading system rules - mirrors the backend rules structure.
 *
 * Each grading model defines term-level behaviour and year-end display rules
 * so that UI components can be driven by a single config object instead of
 * scattering `gradingModel === "continuous_cumulative"` checks everywhere.
 *
 * To add a new grading model:
 *  1. Add the slug to GradingModel
 *  2. Add a RULES entry below
 *  3. Register it in GRADING_RULES
 */

export type GradingModel =
  | "weighted_continuous"
  | "weighted_cumulative"
  | "continuous_cumulative";

export interface GradingDisplayRules {
  /** Scale each term's coursework to the year CW weight in year-end views */
  termCwScaledToYearWeight: boolean;
  /** Where the exam column appears: every term or only final term */
  examColumnLocation: "each_term" | "final_term_only";
  /** Scale the exam score to the year exam weight in year-end views */
  examScaledToYearWeight: boolean;
  /** Show an AVG column (average of term composites) in year-end views */
  showTermAvgColumn: boolean;
  /**
   * Year-end report column layout:
   * - "per_term": show M, H, T (term composites) + Exam + Year Grade
   * - "pooled": show CA /cwW + Exam /exW + Total (no term breakdown)
   */
  yearEndColumns: "per_term" | "pooled";
}

export interface GradingRules {
  name: string;
  slug: GradingModel;
  description: string;
  termHasExam: boolean;
  termHasCoursework: boolean;
  yearAggregation:
    | "average_term_composites"
    | "pool_all_coursework"
    | "combine_all_term_coursework";
  display: GradingDisplayRules;
}

const WEIGHTED_CONTINUOUS_RULES: GradingRules = {
  name: "Weighted Continuous Assessment",
  slug: "weighted_continuous",
  description:
    "Each term has independent coursework and exams. " +
    "Term composites are averaged at year-end and combined with the final exam.",
  termHasExam: true,
  termHasCoursework: true,
  yearAggregation: "average_term_composites",
  display: {
    termCwScaledToYearWeight: false,
    examColumnLocation: "each_term",
    examScaledToYearWeight: false,
    showTermAvgColumn: false,
    yearEndColumns: "per_term",
  },
};

const WEIGHTED_CUMULATIVE_RULES: GradingRules = {
  name: "Weighted Cumulative",
  slug: "weighted_cumulative",
  description:
    "All coursework across all terms is pooled together. " +
    "Term boundaries are ignored for the year-end CA calculation.",
  termHasExam: true,
  termHasCoursework: true,
  yearAggregation: "pool_all_coursework",
  display: {
    termCwScaledToYearWeight: false,
    examColumnLocation: "each_term",
    examScaledToYearWeight: false,
    showTermAvgColumn: false,
    yearEndColumns: "pooled",
  },
};

const CONTINUOUS_CUMULATIVE_RULES: GradingRules = {
  name: "Continuous-Cumulative",
  slug: "continuous_cumulative",
  description:
    "Each term has coursework only (no per-term exam). " +
    "At year-end, all coursework is combined and paired with a single final exam.",
  termHasExam: false,
  termHasCoursework: true,
  yearAggregation: "combine_all_term_coursework",
  display: {
    termCwScaledToYearWeight: true,
    examColumnLocation: "final_term_only",
    examScaledToYearWeight: true,
    showTermAvgColumn: true,
    yearEndColumns: "pooled",
  },
};

const GRADING_RULES: Record<GradingModel, GradingRules> = {
  weighted_continuous: WEIGHTED_CONTINUOUS_RULES,
  weighted_cumulative: WEIGHTED_CUMULATIVE_RULES,
  continuous_cumulative: CONTINUOUS_CUMULATIVE_RULES,
};

const DEFAULT_MODEL: GradingModel = "weighted_continuous";

export function getGradingRules(model?: string | null): GradingRules {
  if (model && model in GRADING_RULES) {
    return GRADING_RULES[model as GradingModel];
  }
  return GRADING_RULES[DEFAULT_MODEL];
}

export function isValidGradingModel(model: string): model is GradingModel {
  return model in GRADING_RULES;
}

export const GRADING_MODEL_LABELS: Record<GradingModel, string> = {
  weighted_continuous: WEIGHTED_CONTINUOUS_RULES.name,
  weighted_cumulative: WEIGHTED_CUMULATIVE_RULES.name,
  continuous_cumulative: CONTINUOUS_CUMULATIVE_RULES.name,
};
