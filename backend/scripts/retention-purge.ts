/**
 * Run the retention purge once, now - what the API's scheduler does daily.
 *
 *   bun run retention:purge [--dry-run] [--retention-days N] [--only <id,id,...>]
 *
 * --dry-run         count what would be purged; change nothing.
 * --retention-days  override SOFT_DELETE_RETENTION_DAYS (and the per-kind
 *                   overrides) for this run. 0 purges everything soft-deleted.
 * --only            restrict the purge to these file / folder / chat message /
 *                   discussion reply ids and skip the global clean-ups (sign-in
 *                   leftovers, erasure-log pruning); for tests.
 *
 * Holds the same advisory lock as the scheduler, so it never runs at the same
 * time as an API instance's purge. Ignores RETENTION_PURGE_ENABLED (running
 * it by hand is the explicit request). Exits 1 if any part failed.
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { ErasureLogService } from '../src/erasure/erasure-log.service';
import { ErasureReplayService } from '../src/erasure/erasure-replay.service';
import { isUuid } from '../src/erasure/erasure-plan';
import { RetentionService, type PurgeReport } from '../src/retention/retention.service';
import { RetentionScheduler } from '../src/retention/retention.scheduler';

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: bun run retention:purge [--dry-run] [--retention-days N] [--only <id,id,...>]');
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const out: { dryRun: boolean; retentionDays?: number; only?: string[] } = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => argv[++i] ?? usage(`${a} needs a value`);
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--retention-days') {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 0) usage('--retention-days must be a whole number >= 0');
      out.retentionDays = n;
    } else if (a === '--only') {
      const ids = value().split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0 || !ids.every(isUuid)) usage('--only takes comma-separated uuids');
      out.only = ids;
    } else if (a === '--help' || a === '-h') usage();
    else usage(`unknown argument ${a}`);
  }
  return out;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaService();
  const storage = new StorageService();
  const erasure = new ErasureLogService(prisma, storage);
  const retention = new RetentionService(prisma, storage, erasure, new ErasureReplayService(prisma, storage));
  const scheduler = new RetentionScheduler(prisma, retention, erasure);

  try {
    let report: PurgeReport | undefined;
    const ran = await scheduler.withLock('gradebook:retention:purge', async () => {
      report = await retention.purge(args);
    });
    if (!ran || !report) {
      console.error('Another purge is running (advisory lock held); try again later.');
      return 1;
    }
    const r = report;
    console.log(`Retention purge${r.dryRun ? ' (dry run, nothing changed)' : ''}${args.retentionDays !== undefined ? ` with ${args.retentionDays}-day retention` : ''}`);
    const rows: [string, number][] = [
      ['files', r.files],
      ['file objects', r.fileObjects],
      ['folders', r.folders],
      ['chat messages', r.chatMessages],
      ['discussion replies deleted', r.discussionRepliesDeleted],
      ['discussion replies scrubbed', r.discussionRepliesScrubbed],
      ['expired sessions', r.sessions],
      ['old sign-in codes', r.emailCodes],
      ['unused remembered devices', r.knownDevices],
      ['erasure log rows pruned', r.erasureLogRows],
      ['erasure log objects pruned', r.erasureLogObjects],
      ['leftover account objects', r.leftoverObjects],
      ['erasure log entries exported', r.exported],
    ];
    for (const [label, n] of rows) console.log(`  ${label.padEnd(30)} ${n}`);
    if (r.timedOut) console.log('  stopped early: RETENTION_PURGE_MAX_MINUTES reached (the next run continues)');
    for (const e of r.errors) console.error(`  ERROR ${e}`);
    return r.errors.length > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`retention:purge failed: ${(err as Error).message}`);
    process.exit(1);
  });
