import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  type PDFObject,
} from '@pdfme/pdf-lib';

/**
 * Removing files attached inside a PDF (`/EmbeddedFile`), so an upload that
 * carries one is accepted without the attachment instead of being refused.
 *
 * PDFs often carry attachments for harmless reasons: LibreOffice's "hybrid
 * PDF" embeds the source document, PDF/A-3 and e-invoices embed data files,
 * Acrobat lets people attach files. The attachment itself is what the upload
 * check refuses (it could smuggle any file past the type check), so it is
 * dropped and the rest of the document kept:
 *
 * - the document-level attachment list (`/Names /EmbeddedFiles`),
 * - associated files (`/AF`) on the catalog and on pages,
 * - file-attachment annotations on pages (`/Subtype /FileAttachment`).
 *
 * Objects nothing reaches any more (the attached files themselves) are
 * deleted, and the document is saved without object streams, so the
 * caller's byte-level check (`inspectPdf`) sees every object and confirms
 * nothing is left. Bookmarks, tags and forms are kept. Encrypted or
 * unreadable PDFs are not rewritten (null): they stay refused as before.
 */

export interface StrippedPdf {
  buffer: Buffer;
  /** Attachments and attachment annotations removed. */
  removed: number;
}

const name = (n: string) => PDFName.of(n);

function lookupDict(doc: PDFDocument, obj: PDFObject | undefined): PDFDict | undefined {
  const value = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  return value instanceof PDFDict ? value : undefined;
}

function lookupArray(doc: PDFDocument, obj: PDFObject | undefined): PDFArray | undefined {
  const value = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  return value instanceof PDFArray ? value : undefined;
}

/** Entries in a name tree (`/Names [key value ...]`, with `/Kids`), counted. */
function countNameTree(doc: PDFDocument, node: PDFDict | undefined, depth = 0): number {
  if (!node || depth > 32) return 0;
  let count = 0;
  const names = lookupArray(doc, node.get(name('Names')));
  if (names) count += Math.floor(names.size() / 2);
  const kids = lookupArray(doc, node.get(name('Kids')));
  if (kids) {
    for (let i = 0; i < kids.size(); i++) count += countNameTree(doc, lookupDict(doc, kids.get(i)), depth + 1);
  }
  return count;
}

/** Delete indirect objects not reachable from the trailer's /Root and /Info. */
function dropUnreachable(doc: PDFDocument): void {
  const context = doc.context;
  const seen = new Set<string>();
  const stack: PDFObject[] = [];
  const root = context.trailerInfo.Root;
  const info = context.trailerInfo.Info;
  if (root) stack.push(root);
  if (info) stack.push(info);
  while (stack.length > 0) {
    const obj = stack.pop()!;
    if (obj instanceof PDFRef) {
      const key = obj.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      const target = context.lookup(obj);
      if (target) stack.push(target);
      continue;
    }
    if (obj instanceof PDFDict) {
      for (const [, value] of obj.entries()) stack.push(value);
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) stack.push(obj.get(i));
    } else if (obj && typeof (obj as { dict?: unknown }).dict === 'object') {
      // A stream: follow its dictionary.
      stack.push((obj as unknown as { dict: PDFDict }).dict);
    }
  }
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!seen.has(ref.toString())) context.delete(ref);
  }
}

export async function stripPdfAttachments(input: Buffer): Promise<StrippedPdf | null> {
  try {
    return await strip(input);
  } catch {
    // A malformed document pdf-lib half-reads (no catalog, broken page
    // tree): not rewritten, so the upload stays refused as before.
    return null;
  }
}

async function strip(input: Buffer): Promise<StrippedPdf | null> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { updateMetadata: false, throwOnInvalidObject: true });
  } catch {
    return null; // encrypted (pdf-lib refuses by default) or not parseable
  }
  // A file pdf-lib reads as having no pages is not rewritten: the result
  // would be an empty document in place of the student's work.
  if (doc.getPageCount() === 0) return null;

  let removed = 0;
  const catalog = doc.catalog;

  const names = lookupDict(doc, catalog.get(name('Names')));
  if (names?.has(name('EmbeddedFiles'))) {
    removed += Math.max(1, countNameTree(doc, lookupDict(doc, names.get(name('EmbeddedFiles')))));
    names.delete(name('EmbeddedFiles'));
  }
  if (catalog.has(name('AF'))) {
    removed += lookupArray(doc, catalog.get(name('AF')))?.size() ?? 1;
    catalog.delete(name('AF'));
  }

  for (const page of doc.getPages()) {
    const node = page.node;
    if (node.has(name('AF'))) {
      removed += lookupArray(doc, node.get(name('AF')))?.size() ?? 1;
      node.delete(name('AF'));
    }
    const annots = lookupArray(doc, node.get(name('Annots')));
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = lookupDict(doc, annots.get(i));
      if (annot?.get(name('Subtype')) === name('FileAttachment')) {
        annots.remove(i);
        removed++;
      }
    }
  }

  // pdf-lib writes every object it holds, reachable or not, so the attached
  // files' streams are dropped explicitly: keep only what the catalog and the
  // info dictionary still reach (bookmarks, tags and forms stay).
  dropUnreachable(doc);
  const bytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  return { buffer: Buffer.from(bytes), removed };
}
