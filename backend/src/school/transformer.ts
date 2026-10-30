import type { school as School } from '@/generated/prisma/client';
import type { UploadLimit } from '@/file-manager/upload-limit.service';

export function v1SchoolList(data: School[]): School[] {
  return data;
}

export function v1SchoolDetail(raw: School): School {
  return raw;
}

export function v1SchoolUploadLimit(raw: UploadLimit): UploadLimit {
  return raw;
}
