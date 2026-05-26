import type { Tables } from '@/types/database.types';

type Grade = Tables<{ schema: 'grading' }, 'grade'>;
type Assessment = Tables<{ schema: 'grading' }, 'assessment'>;

export interface ConvertedGrade {
  label: string;
  gpaPoints: number | null;
  isPass: boolean;
}

export interface GradeWithStudent extends Grade {
  student: { id: string; first_name: string; last_name: string } | null;
  converted: ConvertedGrade | null;
}

export interface AssessmentWithGrades extends Assessment {
  grades: (Pick<
    Grade,
    'id' | 'assessment_id' | 'student_id' | 'score' | 'remarks' | 'is_excluded'
  > & {
    student: { id: string; first_name: string; last_name: string } | null;
    converted: ConvertedGrade | null;
  })[];
}

export interface MessageResponse {
  message: string;
  graded?: number;
}

// Grade transformers
export function v1GradesByAssessment(
  data: GradeWithStudent[],
): GradeWithStudent[] {
  return data;
}

export function v1GradesByTermSubject(
  data: AssessmentWithGrades[],
): AssessmentWithGrades[] {
  return data;
}

export function v1GradeCreated(raw: Grade): Grade {
  return raw;
}

export function v1BulkGraded(raw: MessageResponse): MessageResponse {
  return raw;
}

export function v1GradeUpdated(raw: Grade): Grade {
  return raw;
}

export function v1GradeExcluded(raw: Grade): Grade {
  return raw;
}

// Assessment transformers
export function v1AssessmentList(data: Assessment[]): Assessment[] {
  return data;
}

export function v1AssessmentDetail(raw: Assessment): Assessment {
  return raw;
}

export function v1AssessmentCreated(raw: Assessment): Assessment {
  return raw;
}

export function v1AssessmentUpdated(raw: Assessment): Assessment {
  return raw;
}

export function v1AssessmentExcluded(raw: Assessment): Assessment {
  return raw;
}

export function v1AssessmentDeleted(raw: MessageResponse): MessageResponse {
  return raw;
}
