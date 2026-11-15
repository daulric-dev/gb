import type { PrismaClient } from '@/generated/prisma/client';
import { withJobLease } from '@/common/job-lease';
import { hardeningFor } from './hardening';
import { detectProvider, type DatabaseProvider } from './provider';
import { runSetupSteps, type SetupStep, type StepResult } from './steps/runner';
import { SETUP_STEPS } from './steps/steps';
import { reportOk, type DatabaseHardening, type HardeningReport } from './types';

export interface SetupLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type SetupDb = Pick<
  PrismaClient,
  '$executeRawUnsafe' | '$queryRawUnsafe' | '$transaction' | 'setup_step' | 'job_lease'
>;

/** Serialises `db:harden` runs and boot checks across instances. */
export const SETUP_LEASE_KEY = 'database-setup';
const SETUP_LEASE_MS = 30 * 60_000;

/** The provider for this process: the generated client's, else DATABASE_URL's. */
export function setupProvider(db: unknown): DatabaseProvider {
  return detectProvider({ client: db, url: process.env.DATABASE_URL });
}

/** One line per object that is not `unchanged`, plus a count line. */
export function describeReport(phase: string, report: HardeningReport): string[] {
  const counts = new Map<string, number>();
  for (const r of report.results) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
  const lines = [
    `${phase} (${report.provider}): ` +
      (report.implemented
        ? [...counts].map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing to do'
        : 'application-level enforcement only'),
  ];
  for (const r of report.results) {
    if (r.outcome !== 'unchanged') lines.push(`  ${r.outcome}: ${r.kind} ${r.name}${r.detail ? ` - ${r.detail}` : ''}`);
  }
  return lines;
}

function logReport(logger: SetupLogger, phase: string, report: HardeningReport): boolean {
  const ok = reportOk(report);
  const [head, ...rest] = describeReport(phase, report);
  if (ok) logger.log(head);
  else logger.error(head);
  for (const line of rest) {
    if (line.startsWith('  failed')) logger.error(line);
    else logger.log(line);
  }
  for (const w of report.warnings) logger.warn(w);
  return ok;
}

function logSteps(logger: SetupLogger, results: StepResult[]): boolean {
  for (const r of results) {
    if (r.outcome === 'failed') logger.error(`setup step ${r.key}: failed - ${r.error}`);
    else logger.log(`setup step ${r.key}: ${r.outcome}${r.summary ? ` (${r.summary})` : ''}`);
  }
  return results.every((r) => r.outcome !== 'failed');
}

/** Fails fast, with one clear line, when the database cannot be reached. */
export async function checkConnection(db: Pick<SetupDb, '$queryRawUnsafe'>, logger: SetupLogger): Promise<boolean> {
  try {
    await db.$queryRawUnsafe('SELECT 1');
    return true;
  } catch (err) {
    const e = err as { code?: unknown; message?: string };
    const why = typeof e.code === 'string' ? e.code : (e.message ?? String(err)).trim().split('\n').pop();
    logger.error(`Cannot reach the database at DATABASE_URL (${why}). Is it running?`);
    return false;
  }
}

/** Before `prisma db push`. True when push may go ahead. */
export async function prepareDatabase(
  db: SetupDb,
  logger: SetupLogger,
  hardening: DatabaseHardening = hardeningFor(setupProvider(db)),
): Promise<boolean> {
  return logReport(logger, 'prepare', await hardening.prepare(db));
}

/**
 * After `prisma db push`: the provider's hardening, then the one-off data
 * steps. Holds the `database-setup` job lease (taken with the root client,
 * outside any transaction) so two instances never run it together; returns
 * true without doing anything when another instance holds it.
 */
export async function hardenDatabase(
  db: SetupDb,
  logger: SetupLogger,
  opts: { hardening?: DatabaseHardening; steps?: readonly SetupStep[] } = {},
): Promise<boolean> {
  const hardening = opts.hardening ?? hardeningFor(setupProvider(db));
  let ok = true;
  const ran = await withJobLease(db, SETUP_LEASE_KEY, SETUP_LEASE_MS, async () => {
    ok = logReport(logger, 'harden', await hardening.apply(db)) && ok;
    ok = logSteps(logger, await runSetupSteps(db, opts.steps ?? SETUP_STEPS)) && ok;
  });
  if (!ran) logger.warn('Another instance is running the database setup; skipped.');
  return ok;
}

/** DB_HARDEN_ON_BOOT=true runs `hardenDatabase` when the API starts. Off by default. */
export function hardenOnBoot(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DB_HARDEN_ON_BOOT ?? '').trim().toLowerCase() === 'true';
}
