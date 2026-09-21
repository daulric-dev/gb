export const ALLOWED_CONTENT_TYPES = new Set<string>([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
]);

/** Content types with no reliable byte signature — accepted on declaration. */
const UNVERIFIABLE = new Set<string>(['text/plain', 'text/csv']);

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((b, i) => buffer[i] === b);
}

/** True when the buffer's leading bytes are consistent with `contentType`. */
export function matchesSignature(buffer: Buffer, contentType: string): boolean {
  switch (contentType) {
    case 'application/pdf':
      return startsWith(buffer, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case 'image/png':
      return startsWith(
        buffer,
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      );
    case 'image/jpeg':
      return startsWith(buffer, [0xff, 0xd8, 0xff]);
    case 'image/webp':
      return (
        buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
      );
    // OOXML (xlsx/docx) are ZIP containers: "PK\x03\x04".
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]);
    default:
      return false;
  }
}

export type ContentCheck = { ok: true } | { ok: false; reason: string };

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';


function zipEntryNames(buffer: Buffer): string[] | null {
  
  const EOCD = 0x06054b50;
  const maxComment = 0xffff;
  const start = Math.max(0, buffer.length - maxComment - 22);

  let eocd = -1;
  for (let i = buffer.length - 22; i >= start; i--) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = buffer.readUInt16LE(eocd + 10);
  const dirOffset = buffer.readUInt32LE(eocd + 16);
  if (dirOffset >= buffer.length) return null;

  const names: string[] = [];
  let at = dirOffset;

  for (let i = 0; i < count; i++) {
    // Central directory file header: "PK\x01\x02".
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== 0x02014b50) {
      return null;
    }
    const nameLen = buffer.readUInt16LE(at + 28);
    const extraLen = buffer.readUInt16LE(at + 30);
    const commentLen = buffer.readUInt16LE(at + 32);

    const nameEnd = at + 46 + nameLen;
    if (nameEnd > buffer.length) return null;

    names.push(buffer.toString('utf8', at + 46, nameEnd));
    at = nameEnd + extraLen + commentLen;
  }

  return names;
}

function inspectOoxml(buffer: Buffer, contentType: string): ContentCheck {
  const names = zipEntryNames(buffer);
  if (!names) {
    return { ok: false, reason: 'File is not a readable Office document' };
  }

  if (names.some((n) => n.toLowerCase().endsWith('vbaproject.bin'))) {
    return {
      ok: false,
      reason: 'Macro-enabled documents are not accepted',
    };
  }

  if (!names.includes('[Content_Types].xml')) {
    return { ok: false, reason: 'File is not a valid Office document' };
  }

  const required =
    contentType === DOCX ? 'word/document.xml' : 'xl/workbook.xml';
  if (!names.includes(required)) {
    return {
      ok: false,
      reason: `File contents do not match the declared type ${contentType}`,
    };
  }

  return { ok: true };
}

function inspectPdf(buffer: Buffer): ContentCheck {
  const text = buffer.toString('latin1');

  const dangerous: [RegExp, string][] = [
    [/\/Launch\b/, 'launches an external program'],
    [/\/JavaScript\b/, 'contains JavaScript'],
    [/\/JS\b/, 'contains JavaScript'],
    [/\/EmbeddedFile\b/, 'has an embedded file'],
  ];

  for (const [pattern, why] of dangerous) {
    if (pattern.test(text)) {
      return { ok: false, reason: `PDF rejected: it ${why}` };
    }
  }

  return { ok: true };
}


export function inspectStructure(buffer: Buffer, contentType: string): ContentCheck {
  if (contentType === DOCX || contentType === XLSX) {
    return inspectOoxml(buffer, contentType);
  }
  if (contentType === 'application/pdf') {
    return inspectPdf(buffer);
  }
  return { ok: true };
}

export function verifyContent(buffer: Buffer, contentType: string): ContentCheck {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return { ok: false, reason: `Unsupported file type: ${contentType}` };
  }
  if (UNVERIFIABLE.has(contentType)) {
    return { ok: true };
  }
  if (!matchesSignature(buffer, contentType)) {
    return {
      ok: false,
      reason: `File contents do not match the declared type ${contentType}`,
    };
  }
  return inspectStructure(buffer, contentType);
}
