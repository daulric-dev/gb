/**
 * Before `prisma db push`: what push needs from the database first.
 *
 *   bun run db:prepare
 *
 * PostgreSQL: creates the pg_trgm extension (the schema's trigram indexes
 * need it) and, on a database built by the old SQL migrations, applies the
 * unreleased ones once (src/database-setup/postgresql/legacy-bridge.ts), so
 * push never needs --accept-data-loss. Other providers: nothing yet (says
 * so). Safe to run any number of times. Exits 1 if anything failed: do not
 * run `prisma db push` then.
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { checkConnection, prepareDatabase } from '../src/database-setup/database-setup';

async function main(): Promise<number> {
  const prisma = new PrismaService();
  try {
    if (!(await checkConnection(prisma, console))) return 1;
    return (await prepareDatabase(prisma, console)) ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`db:prepare failed: ${(err as Error).message}`);
    process.exit(1);
  });
