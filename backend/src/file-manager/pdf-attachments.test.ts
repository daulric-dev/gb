import { describe, expect, test } from 'bun:test';
import { PDFDocument, PDFName, PDFString } from '@pdfme/pdf-lib';
import { stripPdfAttachments } from './pdf-attachments';
import { PDF_EMBEDDED_FILE_REASON, verifyContent } from './file-content';

const PDF = 'application/pdf';

async function pdfWith(opts: { attach?: boolean; annotation?: boolean; script?: boolean; outline?: boolean }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  page.drawText('Essay text', { x: 20, y: 250, size: 12 });
  if (opts.attach) {
    await doc.attach(Buffer.from('MZ pretend executable'), 'payload.exe', { mimeType: 'application/octet-stream' });
  }
  if (opts.annotation) {
    const fileStream = doc.context.flateStream(Buffer.from('hidden'), { Type: 'EmbeddedFile' });
    const spec = doc.context.obj({
      Type: 'Filespec',
      F: PDFString.of('note.txt'),
      EF: { F: doc.context.register(fileStream) },
    });
    const annot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'FileAttachment',
      Rect: [10, 10, 30, 30],
      FS: doc.context.register(spec),
    });
    page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  }
  if (opts.script) {
    doc.catalog.set(
      PDFName.of('OpenAction'),
      doc.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }),
    );
  }
  if (opts.outline) {
    const outline = doc.context.obj({ Type: 'Outlines', Count: 0 });
    doc.catalog.set(PDFName.of('Outlines'), doc.context.register(outline));
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

describe('stripPdfAttachments', () => {
  test('a PDF with an attached file is refused as is, and accepted once stripped', async () => {
    const input = await pdfWith({ attach: true, outline: true });
    expect(verifyContent(input, PDF)).toEqual({ ok: false, reason: PDF_EMBEDDED_FILE_REASON });

    const out = await stripPdfAttachments(input);
    expect(out).not.toBeNull();
    expect(out!.removed).toBeGreaterThanOrEqual(1);
    expect(verifyContent(out!.buffer, PDF)).toEqual({ ok: true });
    // The attachment's bytes are gone, the document and its bookmarks stay.
    expect(out!.buffer.toString('latin1')).not.toContain('payload.exe');
    const reread = await PDFDocument.load(out!.buffer);
    expect(reread.getPageCount()).toBe(1);
    expect(reread.catalog.has(PDFName.of('Outlines'))).toBe(true);
  });

  test('file-attachment annotations are removed too', async () => {
    const input = await pdfWith({ annotation: true });
    expect(verifyContent(input, PDF).ok).toBe(false);
    const out = await stripPdfAttachments(input);
    expect(out!.removed).toBe(1);
    expect(verifyContent(out!.buffer, PDF)).toEqual({ ok: true });
  });

  test('stripping attachments does not let JavaScript through', async () => {
    const input = await pdfWith({ attach: true, script: true });
    const out = await stripPdfAttachments(input);
    expect(out).not.toBeNull();
    const verdict = verifyContent(out!.buffer, PDF);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? '' : verdict.reason).toContain('JavaScript');
  });

  test('a PDF without attachments is left equivalent', async () => {
    const input = await pdfWith({});
    const out = await stripPdfAttachments(input);
    expect(out!.removed).toBe(0);
    expect(verifyContent(out!.buffer, PDF)).toEqual({ ok: true });
  });

  test('bytes that are not a PDF are not rewritten', async () => {
    expect(await stripPdfAttachments(Buffer.from('%PDF-1.7 broken'))).toBeNull();
  });
});
