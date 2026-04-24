import type { Tables } from '@/types/database.types';
import type { PaginatedResult } from '@/pagination/pagination.dto';

type Student = Tables<{ schema: 'student' }, 'student'>;

export function v1StudentList(data: Student[]): Student[] {
  return data;
}

export function v1StudentDetail(raw: Student): Student {
  return raw;
}

export function v1StudentCreated(raw: Student): Student {
  return raw;
}

export function v1StudentUpdated(raw: Student): Student {
  return raw;
}

export function v1StudentPaginated(raw: PaginatedResult<Student>): PaginatedResult<Student> {
  return raw;
}
