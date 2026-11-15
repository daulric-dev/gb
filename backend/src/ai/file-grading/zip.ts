import { inflateRawSync } from 'node:zlib';

/**
 * A minimal, bounded ZIP reader for one entry of an Office document (a
 * .docx is a ZIP container). Written for untrusted uploads:
 *
 * - only the central directory is trusted for where an entry is, and the
 *   local header is checked against it;
 * - the entry count, the declared uncompressed size of the entry, and the
 *   declared total of every entry are capped before anything is inflated;
 * - inflating uses zlib's `maxOutputLength`, so an entry whose header lies
 *   about its size (a zip bomb) stops at the cap instead of filling memory;
 * - ZIP64, encrypted entries and methods other than stored / deflate are
 *   refused. Nothing in the archive is ever executed.
 */
export class ZipError extends Error {}

export interface ZipLimits {
  /** Most entries in the archive. */
  maxEntries: number;
  /** Most bytes one inflated entry may have. */
  maxEntryBytes: number;
  /** Most bytes all entries together may declare (uncompressed). */
  maxTotalBytes: number;
}

interface Entry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64 = 0xffffffff;

function centralDirectory(buf: Buffer, limits: ZipLimits): Entry[] {
  if (buf.length < 22) throw new ZipError('not a ZIP archive');
  const start = Math.max(0, buf.length - 0xffff - 22);
  let eocd = -1;
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('not a ZIP archive');
  const count = buf.readUInt16LE(eocd + 10);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirOffset === ZIP64) throw new ZipError('ZIP64 archives are not read');
  if (count > limits.maxEntries) throw new ZipError('the archive has too many parts');
  if (dirOffset >= buf.length) throw new ZipError('the archive is damaged');

  const entries: Entry[] = [];
  let total = 0;
  let at = dirOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== CENTRAL_SIG) throw new ZipError('the archive is damaged');
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const compressedSize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localOffset = buf.readUInt32LE(at + 42);
    if (compressedSize === ZIP64 || size === ZIP64 || localOffset === ZIP64) {
      throw new ZipError('ZIP64 archives are not read');
    }
    const nameEnd = at + 46 + nameLen;
    if (nameEnd > buf.length) throw new ZipError('the archive is damaged');
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipError('the document is too large once unpacked');
    entries.push({ name: buf.toString('utf8', at + 46, nameEnd), method, flags, compressedSize, size, localOffset });
    at = nameEnd + extraLen + commentLen;
  }
  return entries;
}

/** The names of the archive's entries (bounded by `limits`). */
export function zipEntryNames(buf: Buffer, limits: ZipLimits): string[] {
  return centralDirectory(buf, limits).map((e) => e.name);
}

/**
 * One entry's bytes, or null when the archive has no such entry. Throws
 * ZipError for anything unsafe or unreadable.
 */
export function readZipEntry(buf: Buffer, name: string, limits: ZipLimits): Buffer | null {
  const entry = centralDirectory(buf, limits).find((e) => e.name === name);
  if (!entry) return null;
  if (entry.flags & 0x1) throw new ZipError('the document is password-protected');
  if (entry.size > limits.maxEntryBytes) throw new ZipError('the document is too large once unpacked');
  const at = entry.localOffset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== LOCAL_SIG) throw new ZipError('the archive is damaged');
  const dataStart = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buf.length) throw new ZipError('the archive is damaged');
  const data = buf.subarray(dataStart, dataEnd);
  if (entry.method === 0) {
    if (data.length > limits.maxEntryBytes) throw new ZipError('the document is too large once unpacked');
    return Buffer.from(data);
  }
  if (entry.method !== 8) throw new ZipError('the document uses an unsupported compression');
  try {
    // The cap holds even when the header understates the size.
    return inflateRawSync(data, { maxOutputLength: limits.maxEntryBytes });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ERR_BUFFER_TOO_LARGE' || /larger than/i.test((err as Error).message)) {
      throw new ZipError('the document is too large once unpacked');
    }
    throw new ZipError('the archive is damaged');
  }
}
