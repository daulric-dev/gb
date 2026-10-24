import type { academic_year } from '@/generated/prisma/client';
import { dateOnly } from '@/common/db-values';

/**
 * A request's date string ("2025-09-01", or an ISO timestamp) as the value
 * Postgres would store in a `date` column: the calendar date as written,
 * at midnight UTC - not shifted by any time zone in the string.
 */
export function parseDateOnly(value: string): Date {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return new Date(match ? `${match[0]}T00:00:00.000Z` : value);
}

/** An academic_year row exactly as the API has always sent it. */
export function serializeAcademicYear(row: academic_year) {
  return {
    ...row,
    start_date: dateOnly(row.start_date),
    end_date: dateOnly(row.end_date),
  };
}

export type AcademicYearRow = ReturnType<typeof serializeAcademicYear>;
