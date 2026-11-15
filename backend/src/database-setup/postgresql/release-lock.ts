import { Client } from 'pg';

/**
 * A PostgreSQL session advisory lock held for a whole release (prepare,
 * `prisma db push`, harden), so replicas starting together run it one at a
 * time - what `prisma migrate deploy`'s own lock used to give. `db push` has
 * no lock, and the job_lease table may not exist yet before the first push,
 * so this uses a dedicated connection. The lock goes with the connection:
 * a crashed release releases it.
 */
export const RELEASE_LOCK_KEY = 'gradebook:db-release';

export async function withReleaseLock<T>(
  connectionString: string,
  work: () => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [RELEASE_LOCK_KEY]);
    try {
      return await work();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [RELEASE_LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}
