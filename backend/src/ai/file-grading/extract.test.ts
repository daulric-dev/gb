import { describe, expect, test } from 'bun:test';
import { PDFDocument, StandardFonts } from '@pdfme/pdf-lib';
import { classifyFile, DEFAULT_EXTRACT_LIMITS, extractText, textFile, wordXmlText } from './extract';
import { readZipEntry, ZipError } from './zip';
import { makeDocx, makeZip } from './zip-fixture';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function pdf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage();
    if (text) page.drawText(text, { x: 50, y: 700, font, size: 12 });
  }
  return Buffer.from(await doc.save());
}

describe('classifyFile', () => {
  test('text documents and code are read; images, .doc and binaries are not', () => {
    expect(classifyFile('essay.pdf', 'application/pdf').kind).toBe('pdf');
    expect(classifyFile('essay.docx', DOCX).kind).toBe('docx');
    expect(classifyFile('notes.md', 'application/octet-stream').kind).toBe('text');
    expect(classifyFile('main.py', 'text/x-python').kind).toBe('text');
    expect(classifyFile('Main.java', 'application/octet-stream').kind).toBe('text');
    expect(classifyFile('Makefile', 'application/octet-stream').kind).toBe('text');
    const img = classifyFile('photo.jpg', 'image/jpeg');
    expect(img.kind).toBeNull();
    expect((img as { reason: string }).reason).toContain('Images');
    expect(classifyFile('old.doc', 'application/msword').kind).toBeNull();
    expect(classifyFile('game.exe', 'application/octet-stream').kind).toBeNull();
    expect(classifyFile('sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').kind).toBeNull();
  });
});

describe('PDF', () => {
  test('a PDF with a text layer is read page by page', async () => {
    const out = await extractText(await pdf(['Photosynthesis turns light into sugar in the leaves.', 'Second page about chlorophyll.']), {
      name: 'essay.pdf',
      contentType: 'application/pdf',
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain('Photosynthesis turns light into sugar');
    expect(out.text).toContain('[Page 2]');
    expect(out.text).toContain('chlorophyll');
    expect(out.pages).toBe(2);
    expect(out.partial).toBe(false);
  });

  test('an image-only / scanned PDF (no text layer) is unreadable', async () => {
    const out = await extractText(await pdf(['', '']), { name: 'scan.pdf', contentType: 'application/pdf' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain('no text layer');
  });

  test('pages past the limit are not read, and the teacher is told', async () => {
    const pages = Array.from({ length: 5 }, (_, i) => `Page ${i + 1} has a sentence about the water cycle.`);
    const out = await extractText(await pdf(pages), { name: 'long.pdf', contentType: 'application/pdf' }, { ...DEFAULT_EXTRACT_LIMITS, maxPages: 2 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain('Page 2 has');
    expect(out.text).not.toContain('Page 3 has');
    expect(out.note).toContain('first 2 of 5 pages');
    expect(out.partial).toBe(true);
  });

  test('a damaged PDF and a file over the size cap are refused', async () => {
    const bad = await extractText(Buffer.from('%PDF-1.7 garbage'), { name: 'x.pdf', contentType: 'application/pdf' });
    expect(bad.ok).toBe(false);
    const big = await extractText(Buffer.alloc(2048, 0x41), { name: 'x.txt', contentType: 'text/plain' }, { ...DEFAULT_EXTRACT_LIMITS, maxBytes: 1024 });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.reason).toContain('larger than');
  });

  test('extraction has a timeout', async () => {
    const out = await extractText(await pdf(['Some words here for the test of timing.']), { name: 'x.pdf', contentType: 'application/pdf' }, { ...DEFAULT_EXTRACT_LIMITS, timeoutMs: 0 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('too long');
  });
});

describe('Word .docx', () => {
  test('paragraph text is read; tags, deleted text and field codes are not', async () => {
    const out = await extractText(makeDocx(['First paragraph & more.', 'Second <one>.']), { name: 'e.docx', contentType: DOCX });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.text).toBe('First paragraph & more.\nSecond <one>.\n');
    expect(wordXmlText('<w:p><w:r><w:t>Kept</w:t></w:r><w:r><w:delText>gone</w:delText><w:instrText>HYPERLINK x</w:instrText></w:r></w:p>')).toBe('Kept\n');
    expect(wordXmlText('<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b&#233;</w:t><w:br/><w:t>c</w:t></w:r></w:p>')).toBe('a\tbé\nc\n');
  });

  test('macros are never read or run: a vbaProject part is ignored', async () => {
    const out = await extractText(makeDocx(['Visible text'], [{ name: 'word/vbaProject.bin', data: 'Sub AutoOpen() Shell "calc" End Sub' }]), { name: 'm.docx', contentType: DOCX });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.text).not.toContain('Shell');
  });

  test('zip bomb: an entry that inflates past the cap is refused, even when its header lies', async () => {
    const huge = Buffer.alloc(5 * 1024 * 1024, 0x20);
    const zip = makeZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'word/document.xml', data: huge, declaredSize: 100 },
    ]);
    expect(zip.length).toBeLessThan(50_000);
    const limits = { maxEntries: 100, maxEntryBytes: 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 };
    expect(() => readZipEntry(zip, 'word/document.xml', limits)).toThrow(ZipError);
    const out = await extractText(zip, { name: 'bomb.docx', contentType: DOCX }, { ...DEFAULT_EXTRACT_LIMITS, zip: limits });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('too large once unpacked');
  });

  test('declared totals, entry counts and encryption are capped before inflating', () => {
    const many = makeZip(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, data: 'x' })));
    expect(() => readZipEntry(many, 'f0', { maxEntries: 3, maxEntryBytes: 100, maxTotalBytes: 100 })).toThrow('too many');
    const total = makeZip([{ name: 'a', data: 'x', declaredSize: 600 }, { name: 'b', data: 'x', declaredSize: 600 }]);
    expect(() => readZipEntry(total, 'a', { maxEntries: 10, maxEntryBytes: 1000, maxTotalBytes: 1000 })).toThrow('too large');
    const enc = makeZip([{ name: 'word/document.xml', data: 'x', encrypted: true }]);
    expect(() => readZipEntry(enc, 'word/document.xml', DEFAULT_EXTRACT_LIMITS.zip)).toThrow('password');
    expect(() => readZipEntry(Buffer.from('not a zip at all, definitely not'), 'x', DEFAULT_EXTRACT_LIMITS.zip)).toThrow(ZipError);
  });

  test('a .docx with no text is unreadable', async () => {
    const out = await extractText(makeDocx([]), { name: 'empty.docx', contentType: DOCX });
    expect(out.ok).toBe(false);
  });
});

describe('plain text and code', () => {
  test('UTF-8 with a BOM, CRLF line ends', () => {
    const out = textFile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('def f():\r\n    return "é"\r\n')]));
    expect(out).toEqual({ ok: true, text: 'def f():\n    return "é"\n', pages: null, note: null });
  });

  test('binary content and empty files are refused', () => {
    expect(textFile(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2])).ok).toBe(false);
    expect(textFile(Buffer.from('   \n')).ok).toBe(false);
  });

  test('Latin-1 falls back instead of failing', () => {
    const out = textFile(Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    expect(out.ok && out.text).toBe('café');
  });
});
