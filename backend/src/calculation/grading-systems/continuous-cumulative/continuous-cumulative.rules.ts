/**
 * Continuous-Cumulative (Hybrid) Grading System
 *
 * - Each term has ONLY coursework (no per-term exam)
 * - Terms are tracked independently during the year for progress
 * - Year-end: all coursework from all terms is combined → CA block (e.g. 40%)
 * - One final year-end exam → Exam block (e.g. 60%)
 * - Formula: Year = combined_all_term_CW x yearCW% + FinalExam x yearExam%
 */
export const CONTINUOUS_CUMULATIVE_RULES = {
  name: 'Continuous-Cumulative',
  slug: 'continuous_cumulative' as const,
  description:
    'Each term has coursework only (no per-term exam). ' +
    'At year-end, all coursework is combined and paired with a single final exam.',
  termHasExam: false,
  termHasCoursework: true,
  yearAggregation: 'combine_all_term_coursework' as const,
  fallbackBehavior: {
    onlyCoursework: 'use_as_composite' as const,
    onlyExam: 'use_as_year_grade' as const,
    noGrades: 'null' as const,
  },
  display: {
    termCwScaledToYearWeight: true,
    examColumnLocation: 'final_term_only' as const,
    examScaledToYearWeight: true,
  },
};
