import type { term } from '@/generated/prisma/client';
import { dateOnly, num } from '@/common/db-values';

/** A term row exactly as the API has always sent it. */
export function serializeTerm(row: term) {
  return {
    ...row,
    start_date: dateOnly(row.start_date),
    end_date: dateOnly(row.end_date),
    exam_weight: num(row.exam_weight),
    coursework_weight: num(row.coursework_weight),
  };
}

export type TermRow = ReturnType<typeof serializeTerm>;
