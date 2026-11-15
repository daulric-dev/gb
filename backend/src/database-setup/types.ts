import type { PrismaClient } from '@/generated/prisma/client';
import type { DatabaseProvider } from './provider';

/**
 * The part of the Prisma client the hardening step uses: raw statements and
 * interactive transactions. A `PrismaClient`/`PrismaService` satisfies it.
 */
export type HardeningDb = Pick<
  PrismaClient,
  '$executeRawUnsafe' | '$queryRawUnsafe' | '$transaction'
>;

/** What happened to one database object. */
export type ObjectOutcome =
  /** Already there and as expected: nothing was done. */
  | 'unchanged'
  /** Was missing and was created. */
  | 'created'
  /** Was there with a different definition and was replaced. */
  | 'replaced'
  /** Created (a CHECK added NOT VALID) but existing rows do not satisfy it yet. */
  | 'partial'
  /** Not created, by design (e.g. an optional extension that is unavailable). */
  | 'skipped'
  | 'failed';

export interface ObjectResult {
  kind: string;
  name: string;
  outcome: ObjectOutcome;
  detail?: string;
}

export interface HardeningReport {
  provider: DatabaseProvider;
  /** False for providers with application-level enforcement only. */
  implemented: boolean;
  results: ObjectResult[];
  warnings: string[];
}

/**
 * Provider-specific defence in depth, run after `prisma db push`. Every
 * guarantee it adds is also enforced in application code (see
 * prisma/DATABASE_PORTABILITY.md); the database objects catch writes that
 * bypass the application. `apply` must be idempotent: on a database that
 * already has every object it changes nothing.
 */
export interface DatabaseHardening {
  readonly provider: DatabaseProvider;
  /**
   * Before `prisma db push`: what push itself needs (extensions) and the
   * one-time bridge for databases built by the old SQL migrations.
   */
  prepare(db: HardeningDb): Promise<HardeningReport>;
  /** After `prisma db push`: triggers, CHECKs, expression indexes. */
  apply(db: HardeningDb): Promise<HardeningReport>;
}

export const emptyReport = (
  provider: DatabaseProvider,
  implemented: boolean,
): HardeningReport => ({ provider, implemented, results: [], warnings: [] });

/** True when nothing in the report failed. */
export const reportOk = (report: HardeningReport): boolean =>
  report.results.every((r) => r.outcome !== 'failed');
