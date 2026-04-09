export interface SubjectGradeSummary {
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  isGraded: boolean;
  courseworkAverage: number | null;
  examAverage: number | null;
  termComposite: number | null;
  gradeCount: number;
  assessments: AssessmentGrade[];
}

export interface AssessmentGrade {
  assessmentId: string;
  title: string;
  assessmentType: 'exam' | 'coursework';
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
  gradingModel: 'term_based' | 'year_based';
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