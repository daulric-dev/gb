/**
 * Weighted Continuous Assessment System (with term aggregation)
 *
 * - Each term is independently calculated with its own coursework + exam
 * - Term composite = (CW avg x CW weight) + (Exam avg x Exam weight)
 * - Year-end: average all term composites → CA block, then apply year weights
 * - Formula: Year = avg(T1, T2, T3) x yearCW% + FinalExam x yearExam%
 */
export const WEIGHTED_CONTINUOUS_RULES = {
  name: 'Weighted Continuous Assessment',
  slug: 'weighted_continuous' as const,
  description:
    'Each term has independent coursework and exams. ' +
    'Term composites are averaged at year-end and combined with the final exam.',
  termHasExam: true,
  termHasCoursework: true,
  yearAggregation: 'average_term_composites' as const,
  fallbackBehavior: {
    onlyCoursework: 'use_as_composite' as const,
    onlyExam: 'use_as_composite' as const,
    noGrades: 'null' as const,
  },
};
