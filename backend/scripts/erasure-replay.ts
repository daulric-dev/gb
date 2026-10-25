/**
 * Re-apply logged GDPR erasures to the current database - run right after a
 * backup restore, with the time the backup was taken.
 *
 *   bun run erasure:replay --since 2026-10-24T04:00:00Z [--dry-run]
 *       [--source both|db|storage] [--from-file entries.jsonl] [--allow-unsigned] [--json]
 *
 * Entries are read from the database (`compliance.erasure_log`, which the
 * restore rolled back to the backup) and from the copy in object storage
 * (ERASURE_LOG_S3_PREFIX, which the restore did not touch), plus an optional
 * JSON Lines file; the union is de-duplicated by id and applied oldest first.
 * Each entry runs in its own transaction and is idempotent, so running this
 * twice is harmless (the second run reports everything "unchanged"). Entries
 * that were missing from the restored log are written back to it.
 *
 * Exits 1 when any entry fails (fix the cause and run it again) and 2 on bad
 * arguments. See src/erasure/README.md and infrastructure/BACKUPS.md.
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { ErasureReplayService } from '../src/erasure/erasure-replay.service';
import type { ErasureEntry } from '../src/erasure/erasure-log.service';

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}`);
  console.error(
    'usage: bun run erasure:replay --since <ISO timestamp> [--dry-run] [--source both|db|storage] [--from-file <jsonl>] [--allow-unsigned] [--json]',
  );
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const out = { since: '', dryRun: false, source: 'both', fromFile: '', allowUnsigned: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => argv[++i] ?? usage(`${a} needs a value`);
    if (a === '--since') out.since = value();
    else if (a.startsWith('--since=')) out.since = a.slice(8);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--source') out.source = value();
    else if (a === '--from-file') out.fromFile = value();
    else if (a === '--allow-unsigned') out.allowUnsigned = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') usage();
    else usage(`unknown argument ${a}`);
  }
  if (!out.since) usage('--since is required');
  if (!['both', 'db', 'storage'].includes(out.source)) usage('--source must be both, db or storage');
  return out;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const since = new Date(args.since);
  if (Number.isNaN(since.getTime())) usage(`--since is not a timestamp: ${args.since}`);

  const prisma = new PrismaService();
  const storage = new StorageService();
  const replay = new ErasureReplayService(prisma, storage);
  const opts = { dryRun: args.dryRun, allowUnsigned: args.allowUnsigned };

  try {
    const lists: ErasureEntry[][] = [];
    const counts: string[] = [];
    if (args.source !== 'storage') {
      const db = await replay.fromDb(since);
      lists.push(db);
      counts.push(`database ${db.length}`);
    }
    if (args.source !== 'db') {
      const stored = await replay.fromStorage(since, opts);
      lists.push(stored);
      counts.push(`storage ${stored.length}`);
    }
    if (args.fromFile) {
      const file = await replay.fromFile(args.fromFile, since, opts);
      lists.push(file);
      counts.push(`file ${file.length}`);
    }
    const entries = lists.flat();
    console.log(`Erasure replay since ${since.toISOString()}${args.dryRun ? ' (dry run, nothing is changed)' : ''}`);
    console.log(`Entries read: ${counts.join(', ')}`);

    const summary = await replay.replay(entries, opts);
    for (const r of summary.results) {
      const status = r.error ? 'FAILED ' : r.rows + r.objects > 0 || r.restoredLogRow ? (args.dryRun ? 'WOULD  ' : 'APPLIED') : 'nochange';
      const extra = r.error ? `  ${r.error}` : `  rows=${r.rows} objects=${r.objects}${r.restoredLogRow ? ' log-row-restored' : ''}`;
      console.log(`${status.padEnd(8)} ${r.occurredAt} ${r.kind.padEnd(18)} ${r.id}${extra}`);
    }
    console.log(
      `Summary: ${summary.results.length} unique entr${summary.results.length === 1 ? 'y' : 'ies'}, ` +
        `${summary.applied} ${args.dryRun ? 'would change something' : 'applied'}, ${summary.unchanged} unchanged, ` +
        `${summary.failed} failed; rows ${summary.rows}, storage objects ${summary.objects}`,
    );
    if (args.json) console.log(JSON.stringify(summary, null, 2));
    return summary.failed > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`erasure:replay failed: ${(err as Error).message}`);
    process.exit(1);
  });
