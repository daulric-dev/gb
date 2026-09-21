import type {
  AssessmentGrade,
  SubjectGradeSummary,
} from './calculation.interfaces';

export type GradingModel =
  'weighted_continuous' | 'weighted_cumulative' | 'continuous_cumulative';

export interface AssessmentRecord {
  id: string;
  title: string;
  /** @deprecated superseded by grading_group_id; kept until reports migrate. */
  assessment_type: 'exam' | 'coursework';
  /** The weighted group this counts toward. Null falls back to the exam flag. */
  grading_group_id: string | null;
  max_score: number;
  weight: number;
  is_excluded: boolean;
  sort_order: number;
  subject_id: string;
  term_id: string;
}

export interface GradeRecord {
  id: string;
  assessment_id: string;
  student_id: string;
  score: number | null;
  is_excluded: boolean;
  exclusion_reason: string | null;
}

export interface TermWeights {
  courseworkWeight: number;
  examWeight: number;
}

/**
 * One weighted group in the scheme that applies to a subject in a term.
 * `isExam` marks the terminal exam; everything else feeds the continuous
 * block at year-end, which is the split all three models are built on.
 */
export interface GradingGroup {
  id: string;
  name: string;
  weight: number;
  sortOrder: number;
  isExam: boolean;
}

export interface YearConfig {
  yearCourseworkWeight: number;
  yearExamWeight: number;
}

export interface TermSubjectData {
  termId: string;
  termName: string;
  termComposite: number | null;
  courseworkAverage: number | null;
  examAverage: number | null;
  assessments: AssessmentGrade[];
}

/**
 * Pre-fetched data for computing a single subject's grade within a term.
 * Avoids DB calls inside the strategy - the orchestrator provides everything.
 */
export interface SubjectTermContext {
  studentId: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  termId: string;
  termWeights: TermWeights;
  /** The resolved scheme: subject-specific if one exists, else the term default. */
  groups: GradingGroup[];
  assessments: AssessmentRecord[];
  gradesByAssessmentId: Map<string, GradeRecord>;
}

/**
 * Pre-fetched data for computing a single subject's year-end grade.
 */
export interface SubjectYearContext {
  subjectId: string;
  subjectName: string;
  yearConfig: YearConfig;
  termSubjectData: TermSubjectData[];
  /**
   * For cumulative/hybrid systems that need access to raw assessment-level
   * data across all terms (not just the per-term summaries).
   */
  allAssessments: AssessmentRecord[];
  gradeIndex: Map<string, GradeRecord>;
}

/**
 * Every grading system strategy must implement this interface.
 *
 * To add a new grading system:
 * 1. Create a new folder under grading-systems/
 * 2. Implement this interface
 * 3. Register in grading-system.factory.ts
 */
export interface GradingSystemStrategy {
  /**
   * Compute a single subject's grade for one term.
   * Returns the SubjectGradeSummary with coursework/exam averages and
   * the term composite.
   */
  calculateSubjectTermGrade(ctx: SubjectTermContext): SubjectGradeSummary;

  /**
   * Compute a single subject's year-end grade.
   * Receives the per-term summaries and optionally raw assessment data.
   * Returns the final year grade (number) or null if not calculable.
   */
  calculateYearGrade(ctx: SubjectYearContext): number | null;
}
