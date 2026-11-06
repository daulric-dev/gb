/**
 * Move the secrets stored in the database (webhook signing secrets and
 * header values, school SSO client secrets) and the erasure-log copies in
 * object storage off AUTH_SECRET onto DATA_ENCRYPTION_KEY, so AUTH_SECRET
 * can then be rotated without losing them.
 *
 *   bun run secrets:reencrypt [--dry-run] [--skip-erasure-log] [--json]
 *
 * Run it with the CURRENT AUTH_SECRET and the new DATA_ENCRYPTION_KEY both
 * set (the API should already run with DATA_ENCRYPTION_KEY, so nothing new is
 * written under AUTH_SECRET meanwhile). Idempotent: values already under the
 * data key are skipped. Exits 0 when everything is under DATA_ENCRYPTION_KEY
 * (AUTH_SECRET can be rotated), 1 when something could not be decrypted or
 * verified (listed counts; those values were already unusable and must be
 * entered again), 2 on bad arguments or when DATA_ENCRYPTION_KEY is unset.
 * See src/account/README.md.
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { dataEncryptionKey } from '../src/account/secret';
import {
  reencryptStoredSecrets,
  resignErasureLog,
  type RotationCount,
} from '../src/account/secret-rotation';

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: bun run secrets:reencrypt [--dry-run] [--skip-erasure-log] [--json]');
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const out = { dryRun: false, skipErasureLog: false, json: false };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--skip-erasure-log') out.skipErasureLog = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') usage();
    else usage(`unknown argument ${a}`);
  }
  return out;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!dataEncryptionKey()) usage('DATA_ENCRYPTION_KEY must be set (32+ characters)');

  const prisma = new PrismaService();
  try {
    const report: Record<string, RotationCount> = { ...(await reencryptStoredSecrets(prisma, args)) };
    if (!args.skipErasureLog) report.erasureLog = await resignErasureLog(new StorageService(), args);

    console.log(`Re-encrypting stored secrets under DATA_ENCRYPTION_KEY${args.dryRun ? ' (dry run, nothing is changed)' : ''}`);
    for (const [name, c] of Object.entries(report)) {
      console.log(
        `${name.padEnd(15)} scanned ${c.scanned}, ${args.dryRun ? 'would rewrite' : 'rewritten'} ${c.rewritten}, ` +
          `already current ${c.current}, unreadable ${c.failed}, changed meanwhile ${c.raced}`,
      );
    }
    if (args.json) console.log(JSON.stringify(report, null, 2));
    const failed = Object.values(report).reduce((n, c) => n + c.failed, 0);
    const raced = Object.values(report).reduce((n, c) => n + c.raced, 0);
    if (failed > 0) {
      console.log('Some values could not be decrypted or verified with the current keys (see "unreadable").');
      return 1;
    }
    if (raced > 0) console.log('Some values changed while running: run it again to confirm.');
    else if (!args.dryRun) console.log('Done: AUTH_SECRET can now be rotated (users are signed out when it is).');
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`secrets:reencrypt failed: ${(err as Error).message}`);
    process.exit(1);
  });
