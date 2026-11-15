import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { isUniqueViolation } from '@/common/db-values';

/**
 * One-off data steps, without SQL migrations. Each step has a stable key,
 * runs once per database inside a transaction with Prisma only, and is
 * recorded in `setup_step` in that same transaction: if the step fails,
 * neither its changes nor its ledger row are kept, and the next run tries
 * again. Steps must be written so that a fresh, empty database is a no-op.
 *
 * The ledger row is inserted first: a second runner working at the same
 * time blocks on that primary key until the first commits, then gets a
 * unique violation and treats the step as done.
 */
export interface SetupStep {
  /** Stable, never reused. */
  key: string;
  description: string;
  /** Do the work in `tx`; return a short summary (counts, never personal data). */
  run(tx: Prisma.TransactionClient, now: Date): Promise<string>;
}

export type StepDb = Pick<PrismaClient, '$transaction' | 'setup_step'>;

export interface StepResult {
  key: string;
  outcome: 'applied' | 'already-applied' | 'failed';
  summary?: string | null;
  error?: string;
}

const TX = { maxWait: 60_000, timeout: 10 * 60_000 };

export async function runSetupSteps(
  db: StepDb,
  steps: readonly SetupStep[],
  now: Date = new Date(),
): Promise<StepResult[]> {
  const keys = new Set<string>();
  for (const s of steps) {
    if (keys.has(s.key)) throw new Error(`Duplicate setup step key: ${s.key}`);
    keys.add(s.key);
  }

  const results: StepResult[] = [];
  for (const step of steps) {
    const done = await db.setup_step.findUnique({ where: { key: step.key } });
    if (done) {
      results.push({ key: step.key, outcome: 'already-applied', summary: done.summary });
      continue;
    }
    try {
      const summary = await db.$transaction(async (tx) => {
        await tx.setup_step.create({ data: { key: step.key, applied_at: now } });
        const text = await step.run(tx, now);
        await tx.setup_step.update({ where: { key: step.key }, data: { summary: text } });
        return text;
      }, TX);
      results.push({ key: step.key, outcome: 'applied', summary });
    } catch (err) {
      if (isUniqueViolation(err)) {
        results.push({ key: step.key, outcome: 'already-applied' });
      } else {
        results.push({ key: step.key, outcome: 'failed', error: (err as Error).message });
      }
    }
  }
  return results;
}
