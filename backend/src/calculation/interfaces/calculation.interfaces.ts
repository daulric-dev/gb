import type { GradingModel } from './grading-system.interface';

export type { GradingModel };

/** One weighted group's result for a subject in a term. */
export interface GroupAverage {
  groupId: string;
  name: string;
  weight: number;
  isExam: boolean;
  average: number | null;
}

export interface SubjectGradeSummary {
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  isGraded: boolean;
  /** The continuous block: every group not flagged as the exam. */
  courseworkAverage: number | null;
  /** The exam block: the group flagged as the exam. */
  examAverage: number | null;
  termComposite: number | null;
  /** Per-group detail, for schemes richer than the coursework/exam split. */
  groupAverages: GroupAverage[];
  gradeCount: number;
  assessments: AssessmentGrade[];
}

export interface AssessmentGrade {
  assessmentId: string;
  title: string;
  assessmentType: 'exam' | 'coursework';
  groupId: string | null;
  groupName: string | null;
  maxScore: number;
  weight: number;
  score: number | null;
  percentage: number | null;
  isExcluded: boolean;
  exclusionReason: string | null;
}

export interface StudentTermResult {
  studentId: string;
  firstName: string;
  lastName: string;
  termId: string;
  subjects: SubjectGradeSummary[];
  overallAverage: number | null;
  position?: number;
}

export interface StudentYearResult {
  studentId: string;
  firstName: string;
  lastName: string;
  academicYearId: string;
  gradingModel: GradingModel;
  yearCourseworkWeight?: number;
  yearExamWeight?: number;
  terms: {
    termId: string;
    termName: string;
    subjects: SubjectGradeSummary[];
    overallAverage: number | null;
  }[];
  yearEnd: {
    subjects: YearEndSubject[];
    overallAverage: number | null;
  };
  position?: number;
}

export interface YearEndSubject {
  subjectId: string;
  subjectName: string;
  yearGrade: number | null;
  termGrades: {
    termId: string;
    termName: string;
    termComposite: number | null;
  }[];
}
