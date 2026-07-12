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

export function verifyContent(
  buffer: Buffer,
  contentType: string,
): ContentCheck {
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
  return { ok: true };
}
