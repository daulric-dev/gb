/**
 * One-off copy of every object in the legacy hosted storage buckets into the
 * S3 bucket, under `<bucket>/<path>` - the key the API now reads them by.
 *
 *   LEGACY_STORAGE_URL=https://<ref>.supabase.co \
 *   LEGACY_STORAGE_SERVICE_KEY=<service role key> \
 *   bun run storage:copy [--dry-run] [--bucket images]
 *
 * Idempotent: an object already in S3 with the same size is skipped, so it can
 * be re-run until it reports nothing left to copy (e.g. once more at cutover).
 * S3 settings come from the usual S3_* variables.
 */
import { createClient } from '@supabase/supabase-js';
import { StorageService } from '../src/storage/storage.service';
import { objectKey } from '../src/storage/keys';

const BUCKETS = ['images', 'file-manager', 'report-books'];
const PAGE = 1000;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const only = args.includes('--bucket') ? args[args.indexOf('--bucket') + 1] : undefined;

const url = process.env.LEGACY_STORAGE_URL;
const key = process.env.LEGACY_STORAGE_SERVICE_KEY;
if (!url || !key) {
  console.error('Set LEGACY_STORAGE_URL and LEGACY_STORAGE_SERVICE_KEY.');
  process.exit(1);
}

const legacy = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage;
const s3 = new StorageService();

interface Entry {
  path: string;
  size: number | null;
  contentType: string | undefined;
}

/** Every object under `prefix`, walking folders depth-first. */
async function* walk(bucket: string, prefix = ''): AsyncGenerator<Entry> {
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await legacy.from(bucket).list(prefix, {
      limit: PAGE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const item of data ?? []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      // Folders come back with no id and no metadata.
      if (item.id === null) {
        yield* walk(bucket, path);
        continue;
      }
      const meta = (item.metadata ?? {}) as { size?: number; mimetype?: string };
      yield { path, size: meta.size ?? null, contentType: meta.mimetype };
    }
    if (!data || data.length < PAGE) return;
  }
}

async function copyBucket(bucket: string) {
  const totals = { copied: 0, skipped: 0, failed: 0, bytes: 0 };
  const { error } = await legacy.getBucket(bucket);
  if (error) {
    console.warn(`- ${bucket}: not found in legacy storage, skipping`);
    return totals;
  }

  for await (const entry of walk(bucket)) {
    const target = objectKey(bucket, entry.path);
    const existing = await s3.exists(target);
    if (existing && (entry.size === null || existing.size === entry.size)) {
      totals.skipped++;
      continue;
    }
    if (dryRun) {
      console.log(`  would copy ${bucket}/${entry.path} -> ${target} (${entry.size ?? '?'} bytes)`);
      totals.copied++;
      totals.bytes += entry.size ?? 0;
      continue;
    }
    try {
      const { data, error: dlError } = await legacy.from(bucket).download(entry.path);
      if (dlError || !data) throw new Error(dlError?.message ?? 'empty download');
      const body = Buffer.from(await data.arrayBuffer());
      await s3.put(target, body, entry.contentType || data.type || undefined);
      totals.copied++;
      totals.bytes += body.byteLength;
      console.log(`  copied ${target} (${body.byteLength} bytes)`);
    } catch (err) {
      totals.failed++;
      console.error(`  FAILED ${bucket}/${entry.path}: ${(err as Error).message}`);
    }
  }
  return totals;
}

const buckets = only ? [only] : BUCKETS;
console.log(`Copying ${buckets.join(', ')} from ${url} into s3://${s3.bucket}${dryRun ? ' (dry run)' : ''}`);
let failed = 0;
for (const bucket of buckets) {
  const t = await copyBucket(bucket);
  failed += t.failed;
  console.log(
    `- ${bucket}: ${dryRun ? 'to copy' : 'copied'} ${t.copied} (${t.bytes} bytes), already there ${t.skipped}, failed ${t.failed}`,
  );
}
process.exit(failed ? 1 : 0);
