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
