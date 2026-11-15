/**
 * After `prisma db push`: provider-specific hardening, then the one-off
 * data steps.
 *
 *   bun run db:harden
 *
 * PostgreSQL: creates or repairs the audit append-only triggers, the
 * student left_at and peer-review not-self triggers, the expression unique
 * indexes and the CHECK constraints (src/database-setup/postgresql). Objects
 * already in place are left alone, so it is safe to run on every deploy and
 * on a database built by the old SQL migrations. Other providers: logs that
 * only application-level enforcement applies. Then runs each setup step not
 * yet recorded in `setup_step` (src/database-setup/steps). Exits 1 if
 * anything failed.
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { checkConnection, hardenDatabase } from '../src/database-setup/database-setup';

async function main(): Promise<number> {
  const prisma = new PrismaService();
  try {
    if (!(await checkConnection(prisma, console))) return 1;
    return (await hardenDatabase(prisma, console)) ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`db:harden failed: ${(err as Error).message}`);
    process.exit(1);
  });
