import type { Prisma } from '@/generated/prisma/client';

/**
 * Case-insensitive text matching for search boxes (student names, library
 * items, schools, rostering changes), as Prisma string filters.
 *
 * Provider-specific on purpose. Prisma's `mode: 'insensitive'` exists only
 * on PostgreSQL and CockroachDB; MySQL/MariaDB compare case-insensitively
 * through the column collation, and SQLite / SQL Server need their own
 * approach. On PostgreSQL the student name search is also served by the
 * optional `pg_trgm` GIN indexes (`idx_student_first_name_trgm`,
 * `idx_student_last_name_trgm`): a performance aid only, never needed for
 * correct results. Another provider supplies its own `TextSearch` (and its
 * own optional indexes) without touching the callers.
 */
export interface TextSearch {
  /** Values containing `text`, ignoring case. */
  contains(text: string): { contains: string; mode?: Prisma.QueryMode };
  /** Values equal to `text`, ignoring case. */
  equals(text: string): { equals: string; mode?: Prisma.QueryMode };
}

/** PostgreSQL: ILIKE through Prisma's insensitive mode. */
export const postgresTextSearch: TextSearch = {
  contains: (text) => ({ contains: text, mode: 'insensitive' }),
  equals: (text) => ({ equals: text, mode: 'insensitive' }),
};

/** The implementation for the provider this build targets (PostgreSQL only, for now). */
export const textSearch: TextSearch = postgresTextSearch;
