import type { Tables } from '@/types/database.types';

type School = Tables<'school'>;

export function v1SchoolList(data: School[]): School[] {
  return data;
}

export function v1SchoolDetail(raw: School): School {
  return raw;
}
