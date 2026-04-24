import type { Tables } from '@/types/database.types';

type Enrollment = Tables<{ schema: 'student' }, 'student_group_enrollment'>;

export interface EnrolledStudentItem {
  id: string;
  enrolled_at: string | null;
  student: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    gender: string | null;
    date_of_birth: string | null;
    is_active: boolean | null;
  };
  subjects: { id: string; name: string; code: string }[];
}

export interface StudentSubjectItem {
  id: number;
  subject: {
    id: string;
    name: string | null;
    code: string | null;
    is_graded: boolean | null;
    sort_order: number | null;
  } | null;
}

export interface MessageResponse {
  message: string;
}

export interface BulkResponse {
  enrolled?: number;
  assigned?: number;
  message: string;
}

export function v1EnrolledStudents(
  data: EnrolledStudentItem[],
): EnrolledStudentItem[] {
  return data;
}

export function v1StudentSubjects(
  data: StudentSubjectItem[],
): StudentSubjectItem[] {
  return data;
}

export function v1Enrolled(raw: Enrollment): Enrollment {
  return raw;
}

export function v1BulkEnrolled(raw: BulkResponse): BulkResponse {
  return raw;
}

export function v1Unenrolled(raw: MessageResponse): MessageResponse {
  return raw;
}

export function v1SubjectsAssigned(raw: BulkResponse): BulkResponse {
  return raw;
}

export function v1BulkSubjectsAssigned(raw: BulkResponse): BulkResponse {
  return raw;
}

export function v1SubjectRemoved(raw: MessageResponse): MessageResponse {
  return raw;
}
