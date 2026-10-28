import type { StudentRow } from './student.rows';
import type { PaginatedResult } from '@/pagination/pagination.dto';

type Student = StudentRow;

export function v1StudentList(data: Student[]): Student[] {
  return data;
}

export function v1StudentDetail(raw: Student): Student {
  return raw;
}

export function v1StudentUpdated(raw: Student): Student {
  return raw;
}

export function v1StudentPaginated(
  raw: PaginatedResult<Student>,
): PaginatedResult<Student> {
  return raw;
}
