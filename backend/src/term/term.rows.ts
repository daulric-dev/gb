import type { term } from '@/generated/prisma/client';
import { dateOnly } from '@/common/db-values';

/** A term row exactly as the API has always sent it. */
export function serializeTerm(row: term) {
  return {
    ...row,
    start_date: dateOnly(row.start_date),
    end_date: dateOnly(row.end_date),
  };
}

export type TermRow = ReturnType<typeof serializeTerm>;
