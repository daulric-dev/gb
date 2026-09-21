import { describe, test, expect } from 'bun:test';
import {
  verifyContent,
  matchesSignature,
  inspectStructure,
} from './file-content';
import { crc32 } from 'node:zlib';

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // %PDF-1
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]); // xlsx/docx
function webp(): Buffer {
  const b = Buffer.alloc(16, 0);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  return b;
}

describe('matchesSignature', () => {
  test('accepts each fingerprintable format', () => {
    expect(matchesSignature(PDF, 'application/pdf')).toBe(true);
    expect(matchesSignature(PNG, 'image/png')).toBe(true);
    expect(matchesSignature(JPEG, 'image/jpeg')).toBe(true);
    expect(matchesSignature(webp(), 'image/webp')).toBe(true);
    expect(
      matchesSignature(
        ZIP,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe(true);
  });

  test('rejects bytes that do not match the declared type', () => {
    expect(matchesSignature(PNG, 'application/pdf')).toBe(false);
    expect(matchesSignature(PDF, 'image/png')).toBe(false);
    expect(matchesSignature(Buffer.alloc(2), 'image/jpeg')).toBe(false);
  });
});

describe('verifyContent', () => {
  test('passes a well-formed, allowed binary file', () => {
    expect(verifyContent(PDF, 'application/pdf')).toEqual({ ok: true });
  });

  test('accepts text types without a signature', () => {
    expect(verifyContent(Buffer.from('hello'), 'text/plain')).toEqual({
      ok: true,
    });
    expect(verifyContent(Buffer.from('a,b,c'), 'text/csv')).toEqual({
      ok: true,
    });
  });

  test('rejects an unsupported type', () => {
    const r = verifyContent(Buffer.from('<svg/>'), 'image/svg+xml');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('Unsupported');
  });

  test('rejects a file whose bytes contradict the declared type', () => {
    // Declared PDF, actually a PNG — the classic content-type spoof.
    const r = verifyContent(PNG, 'application/pdf');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('do not match');
  });
});

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * A real ZIP, built by hand so the central-directory walk is exercised for
 * what it is rather than against a fixture that happens to parse.
 */
function makeZip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length + data.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // stored, no compression
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    data.copy(local, 30 + nameBuf.length);
    locals.push(local);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // central directory header
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return Buffer.concat([localPart, centralPart, eocd]);
}

const validDocx = () =>
  makeZip({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': '<w:document/>',
  });

const validXlsx = () =>
  makeZip({
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': '<workbook/>',
  });

/**
 * Structural inspection is the layer that replaced virus scanning. It does not
 * detect malware; it rejects files carrying something built to run, and files
 * that are not the format they claim past their first four bytes.
 */
describe('inspectStructure - Office documents', () => {
  test('accepts a well-formed docx and xlsx', () => {
    expect(verifyContent(validDocx(), DOCX)).toEqual({ ok: true });
    expect(verifyContent(validXlsx(), XLSX)).toEqual({ ok: true });
  });

  test('rejects an arbitrary ZIP declared as a document', () => {
    // Every OOXML file is a ZIP, so leading bytes alone let any archive
    // through. This is the hole the structural check exists to close.
    const r = verifyContent(makeZip({ 'payload.exe': 'MZ...' }), DOCX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not a valid Office document');
  });

  test('rejects a macro-enabled document renamed to .docx', () => {
    const r = verifyContent(
      makeZip({
        '[Content_Types].xml': '<Types/>',
        'word/document.xml': '<w:document/>',
        'word/vbaProject.bin': 'macro bytes',
      }),
      DOCX,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('Macro-enabled');
  });

  test('rejects a workbook uploaded as a document', () => {
    const r = verifyContent(validXlsx(), DOCX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('do not match');
  });

  test('rejects an unreadable archive', () => {
    // Valid ZIP signature, nothing behind it.
    const r = verifyContent(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), DOCX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not a readable Office document');
  });
});

describe('inspectStructure - PDFs', () => {
  const pdf = (body: string) => Buffer.from(`%PDF-1.7\n${body}`);

  test('accepts an ordinary PDF', () => {
    expect(
      verifyContent(pdf('1 0 obj << /Type /Catalog >>'), 'application/pdf'),
    ).toEqual({
      ok: true,
    });
  });

  test('accepts /OpenAction on its own', () => {
    // Common and usually benign - opening at a page, setting a zoom. Only
    // dangerous combined with the constructs below, which are rejected.
    expect(
      verifyContent(pdf('/OpenAction [ 3 0 R /Fit ]'), 'application/pdf'),
    ).toEqual({ ok: true });
  });

  test('rejects a PDF that launches a program', () => {
    const r = verifyContent(
      pdf('/OpenAction << /S /Launch /F (calc.exe) >>'),
      'application/pdf',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('launches an external program');
  });

  test('rejects a PDF carrying JavaScript', () => {
    const r = verifyContent(
      pdf('/S /JavaScript /JS (app.alert\\(1\\))'),
      'application/pdf',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('JavaScript');
  });

  test('rejects a PDF with an embedded file', () => {
    const r = verifyContent(
      pdf('/Type /EmbeddedFile /Subtype /application#2Fexe'),
      'application/pdf',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('embedded file');
  });
});

describe('inspectStructure - other types', () => {
  test('leaves images and text alone', () => {
    expect(inspectStructure(PNG, 'image/png')).toEqual({ ok: true });
    expect(inspectStructure(Buffer.from('a,b'), 'text/csv')).toEqual({
      ok: true,
    });
  });
});
