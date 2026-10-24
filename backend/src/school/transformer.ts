import type { school as School } from '@/generated/prisma/client';

export function v1SchoolList(data: School[]): School[] {
  return data;
}

export function v1SchoolDetail(raw: School): School {
  return raw;
}
