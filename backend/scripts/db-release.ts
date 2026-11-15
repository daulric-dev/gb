/**
 * The production release step: prepare, `prisma db push`, harden - under
 * one PostgreSQL advisory lock so replicas starting together take turns.
 *
 *   bun run db:release
 *
 * Used by the container at start (MIGRATE_ON_START), the PM2 deploy script
 * and the compose `migrate` service. Unlike `db:deploy` it does not run
 * `prisma generate` (a built image already holds the client). Never passes
 * --accept-data-loss: if push would lose data it stops, and so does this.
 */
import { spawnSync } from 'node:child_process';
import { PrismaService } from '../src/prisma/prisma.service';
import { checkConnection, hardenDatabase, prepareDatabase, setupProvider } from '../src/database-setup/database-setup';
import { withReleaseLock } from '../src/database-setup/postgresql/release-lock';

function push(): boolean {
  const r = spawnSync('bunx', ['prisma', 'db', 'push'], { stdio: 'inherit' });
  return r.status === 0;
}

async function release(prisma: PrismaService): Promise<number> {
  if (!(await prepareDatabase(prisma, console))) {
    console.error('db:release: the pre-push step failed; not pushing the schema.');
    return 1;
  }
  if (!push()) {
    console.error('db:release: prisma db push failed.');
    return 1;
  }
  return (await hardenDatabase(prisma, console)) ? 0 : 1;
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('db:release: DATABASE_URL is not set.');
    return 1;
  }
  const prisma = new PrismaService();
  try {
    if (!(await checkConnection(prisma, console))) return 1;
    if (setupProvider(prisma) === 'postgresql') return await withReleaseLock(url, () => release(prisma));
    console.warn('db:release: no release lock for this provider; run one release at a time.');
    return await release(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`db:release failed: ${(err as Error).message}`);
    process.exit(1);
  });
