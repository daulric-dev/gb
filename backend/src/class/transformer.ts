import type { Tables } from '@/types/database.types';

type StudentGroup = Tables<'student_group'>;

export interface MyClassItem {
  id: string;
  name: string | null;
  academicYearId: string | null;
  isClassTeacher: boolean | null;
  createdAt: string | null;
}

export interface TeacherItem {
  teacherId: string;
  firstName: string | null;
  lastName: string | null;
  isClassTeacher: boolean | null;
  subjects: { id: string; name: string; code: string }[];
}

export interface TeacherAddedResponse {
  teacherId: string;
  classId: string;
  subjectIds: string[];
}

export interface SubjectItem {
  id: string;
  name: string | null;
  code: string | null;
  is_graded: boolean | null;
  sort_order: number | null;
}

export function v1ClassList(data: MyClassItem[]): MyClassItem[] {
  return data;
}

export function v1ClassDetail(raw: StudentGroup): StudentGroup {
  return raw;
}

export function v1ClassCreated(raw: StudentGroup): StudentGroup {
  return raw;
}

export function v1ClassUpdated(raw: StudentGroup): StudentGroup {
  return raw;
}

export function v1ClassDeleted(raw: string): string {
  return raw;
}

export function v1TeacherList(data: TeacherItem[]): TeacherItem[] {
  return data;
}

export function v1TeacherAdded(raw: TeacherAddedResponse): TeacherAddedResponse {
  return raw;
}

export function v1TeacherRemoved(raw: string): string {
  return raw;
}

export function v1SubjectList(data: SubjectItem[]): SubjectItem[] {
  return data;
}
