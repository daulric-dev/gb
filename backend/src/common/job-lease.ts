import { randomUUID } from 'node:crypto';
import type { PrismaService } from '@/prisma/prisma.service';
import { isUniqueViolation } from './db-values';

type LeaseDb = Pick<PrismaService, 'job_lease'>;

/** Claim a database-backed lease. Expired leases can be safely reclaimed. */
export async function acquireJobLease(
  db: LeaseDb,
  key: string,
  leaseMs: number,
  now = new Date(),
): Promise<string | null> {
  const ownerToken = randomUUID();
  const expiresAt = new Date(now.getTime() + leaseMs);
  try {
    await db.job_lease.create({
      data: { key, owner_token: ownerToken, expires_at: expiresAt, updated_at: now },
    });
    return ownerToken;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const reclaimed = await db.job_lease.updateMany({
    where: {
      key,
      OR: [{ expires_at: null }, { expires_at: { lte: now } }],
    },
    data: { owner_token: ownerToken, expires_at: expiresAt, updated_at: now },
  });
  return reclaimed.count === 1 ? ownerToken : null;
}

/** Release only the lease this worker owns. */
export async function releaseJobLease(
  db: LeaseDb,
  key: string,
  ownerToken: string,
  now = new Date(),
): Promise<void> {
  await db.job_lease.updateMany({
    where: { key, owner_token: ownerToken },
    data: { owner_token: null, expires_at: null, updated_at: now },
  });
}

/**
 * Run `work` while holding the lease `key`; false (and `work` not run) when
 * another worker holds an unexpired lease. The portable replacement for a
 * PostgreSQL transaction-scoped advisory lock: `leaseMs` plays the part of
 * the old transaction timeout, after which another instance may take over.
 *
 * Uses the root client on purpose. Never call this inside an interactive
 * transaction: the claim relies on a unique-violation insert, which aborts
 * a PostgreSQL transaction.
 */
export async function withJobLease(
  db: LeaseDb,
  key: string,
  leaseMs: number,
  work: () => Promise<void>,
): Promise<boolean> {
  const ownerToken = await acquireJobLease(db, key, leaseMs);
  if (!ownerToken) return false;
  try {
    await work();
  } finally {
    // A failed release only delays the next holder until the lease expires.
    await releaseJobLease(db, key, ownerToken).catch(() => undefined);
  }
  return true;
}
