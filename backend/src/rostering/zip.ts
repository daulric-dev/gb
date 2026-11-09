import { inflateRawSync } from 'node:zlib';

/**
 * A small ZIP reader for OneRoster CSV bundles: stored and deflated entries,
 * no encryption, no ZIP64. Reads the central directory, so local headers
 * with data descriptors work too. Every entry and the total are capped
 * (zip bombs): inflate stops at the cap and the bundle is refused.
 */
export const ZIP_MAX_ENTRY_BYTES = 40 * 1024 * 1024;
export const ZIP_MAX_TOTAL_BYTES = 120 * 1024 * 1024;
export const ZIP_MAX_ENTRIES = 64;

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

export class ZipError extends Error {}

export function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === LOC_SIG;
}

/** Entries by lower-cased base name (folders inside the zip are ignored). */
export function readZip(
  buf: Buffer,
  limits = { entry: ZIP_MAX_ENTRY_BYTES, total: ZIP_MAX_TOTAL_BYTES },
): Map<string, Buffer> {
  // The end-of-central-directory record is in the last 22 + 65535 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('Not a ZIP file');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (count > ZIP_MAX_ENTRIES) throw new ZipError(`The ZIP has more than ${ZIP_MAX_ENTRIES} files`);

  const out = new Map<string, Buffer>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CEN_SIG) {
      throw new ZipError('The ZIP file is damaged');
    }
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    offset += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (flags & 0x1) throw new ZipError('Encrypted ZIP files are not supported');
    if (size > limits.entry) throw new ZipError(`${name} is too large`);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== LOC_SIG) {
      throw new ZipError('The ZIP file is damaged');
    }
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compressed);
    if (raw.length !== compressed) throw new ZipError('The ZIP file is damaged');

    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(raw);
    } else if (method === 8) {
      try {
        data = inflateRawSync(raw, { maxOutputLength: limits.entry });
      } catch {
        throw new ZipError(`${name} could not be unpacked (damaged or too large)`);
      }
    } else {
      throw new ZipError(`${name} uses an unsupported compression method`);
    }
    total += data.length;
    if (total > limits.total) throw new ZipError('The ZIP unpacks to more than the limit');
    const base = name.split('/').pop()!.toLowerCase();
    // Skip macOS resource forks and hidden files.
    if (base.startsWith('.') || name.startsWith('__MACOSX/')) continue;
    out.set(base, data);
  }
  return out;
}
