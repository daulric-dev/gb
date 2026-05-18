/**
 * Weighted Cumulative Grading System
 *
 * - No term boundaries in the CA calculation
 * - All coursework assessments from all terms are pooled into one weighted average
 * - Year-end: pooled CA x yearCW% + Final Exam x yearExam%
 * - Term composites still exist for display but are not used in the year formula
 */
export const WEIGHTED_CUMULATIVE_RULES = {
  name: 'Weighted Cumulative',
  slug: 'weighted_cumulative' as const,
  description:
    'All coursework across all terms is pooled together. ' +
    'Term boundaries are ignored for the year-end CA calculation.',
  termHasExam: true,
  termHasCoursework: true,
  yearAggregation: 'pool_all_coursework' as const,
  fallbackBehavior: {
    onlyCoursework: 'use_as_composite' as const,
    onlyExam: 'use_as_composite' as const,
    noGrades: 'null' as const,
  },
};
