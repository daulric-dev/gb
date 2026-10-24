import type { student } from '@/generated/prisma/client';
import { dateOnly } from '@/common/db-values';

/** A student row exactly as the API has always sent it. */
export function serializeStudent(row: student) {
  return {
    ...row,
    date_of_birth: dateOnly(row.date_of_birth),
    enrollment_date: dateOnly(row.enrollment_date),
  };
}

export type StudentRow = ReturnType<typeof serializeStudent>;
