import { ZipArchive } from 'archiver';
import { ObjectTooLargeError } from '@/storage/storage.service';
import type { ExportObject } from './data-export.types';

export interface ArchiveLimits {
  /** Largest single stored object copied in (bytes). */
  maxObjectBytes: number;
  /** Most bytes of stored objects copied in, all together. */
  maxTotalObjectBytes: number;
}

export interface SkippedObject {
  path: string;
  reason: 'too_large' | 'size_limit' | 'missing' | 'error';
}

export interface ArchiveInput {
  /** `<name>.json` entries: name -> value. */
  json: Record<string, unknown>;
  objects: ExportObject[];
  /** Built once the objects are copied, so it can mention what was skipped. */
  readme: (skipped: SkippedObject[], included: number) => string;
  storage: { getBuffer(key: string, maxBytes?: number): Promise<Buffer | null> };
  limits: ArchiveLimits;
}

export interface ArchiveOutput {
  zip: Buffer;
  objectsIncluded: number;
  skipped: SkippedObject[];
}

/** JSON.stringify for database rows: bigint as a number (or string when too big). */
export function exportJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_k, v) => {
      if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
      return v;
    },
    2,
  );
}

/**
 * Builds the export ZIP in memory: README.txt, one JSON file per category,
 * and the stored objects under files/. An object that is too big, missing
 * or unreadable is listed in files-not-included.json instead of failing the
 * whole export; the same object is copied once even when two categories
 * name it.
 */
export async function buildArchive(input: ArchiveInput): Promise<ArchiveOutput> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    archive.on('data', (c: Buffer) => chunks.push(c));
    archive.on('end', () => resolve());
    archive.on('error', reject);
    archive.on('warning', reject);
  });

  for (const [name, value] of Object.entries(input.json)) {
    archive.append(exportJson(value), { name: `${name}.json` });
  }

  const skipped: SkippedObject[] = [];
  const seenKeys = new Set<string>();
  const usedPaths = new Set<string>();
  let total = 0;
  let included = 0;
  for (const obj of input.objects) {
    if (seenKeys.has(obj.key)) continue;
    seenKeys.add(obj.key);
    let path = obj.path;
    for (let n = 2; usedPaths.has(path); n++) path = obj.path.replace(/(\.[^./]+)?$/, `-${n}$1`);
    usedPaths.add(path);
    if (obj.size != null && obj.size > input.limits.maxObjectBytes) {
      skipped.push({ path, reason: 'too_large' });
      continue;
    }
    if (obj.size != null && total + obj.size > input.limits.maxTotalObjectBytes) {
      skipped.push({ path, reason: 'size_limit' });
      continue;
    }
    let body: Buffer | null;
    try {
      body = await input.storage.getBuffer(obj.key, input.limits.maxObjectBytes);
    } catch (err) {
      skipped.push({ path, reason: err instanceof ObjectTooLargeError ? 'too_large' : 'error' });
      continue;
    }
    if (!body) {
      skipped.push({ path, reason: 'missing' });
      continue;
    }
    if (total + body.length > input.limits.maxTotalObjectBytes) {
      skipped.push({ path, reason: 'size_limit' });
      continue;
    }
    total += body.length;
    included += 1;
    archive.append(body, { name: path });
  }

  if (skipped.length > 0) {
    archive.append(exportJson(skipped), { name: 'files-not-included.json' });
  }
  archive.append(input.readme(skipped, included), { name: 'README.txt' });
  void archive.finalize();
  await done;
  return { zip: Buffer.concat(chunks), objectsIncluded: included, skipped };
}
