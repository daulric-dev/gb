import {
  AI_DOCX_MAX_ENTRIES,
  AI_DOCX_MAX_TOTAL_BYTES,
  AI_DOCX_MAX_XML_BYTES,
  AI_FILE_EXTRACT_TIMEOUT_MS,
  AI_FILE_MAX_BYTES,
  AI_FILE_MAX_PAGES,
  AI_PDF_MIN_TEXT_CHARS,
} from './file-grading.constants';
import { readZipEntry, ZipError, type ZipLimits } from './zip';

/**
 * Text from the files students hand in, read on the server so every
 * provider (a local Ollama included) gets plain text. Text documents only:
 *
 * - PDF with a text layer (unpdf, a serverless pdf.js build: no eval, no
 *   fonts loaded, no scripting, no XFA);
 * - Word .docx (the document part unpacked by our bounded ZIP reader and
 *   its runs of text read from the XML; macros are never run or read);
 * - plain text, Markdown, CSV and common code / source files.
 *
 * Images, scanned or image-only PDFs, legacy .doc and anything else are
 * reported as unreadable, with the reason, and never sent.
 */

export type FileKind = 'pdf' | 'docx' | 'text';

export interface ExtractLimits {
  maxBytes: number;
  maxPages: number;
  timeoutMs: number;
  zip: ZipLimits;
}

export const DEFAULT_EXTRACT_LIMITS: ExtractLimits = {
  maxBytes: AI_FILE_MAX_BYTES,
  maxPages: AI_FILE_MAX_PAGES,
  timeoutMs: AI_FILE_EXTRACT_TIMEOUT_MS,
  zip: { maxEntries: AI_DOCX_MAX_ENTRIES, maxEntryBytes: AI_DOCX_MAX_XML_BYTES, maxTotalBytes: AI_DOCX_MAX_TOTAL_BYTES },
};

export type ExtractResult =
  /** `partial`: part of the file was not read (pages past the limit). */
  | { ok: true; text: string; pages: number | null; note: string | null; partial?: boolean }
  | { ok: false; reason: string; pages?: number | null };

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Text-like content types (besides text/*). */
const TEXT_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/x-sh',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
  'application/x-python',
  'application/x-python-code',
  'application/sql',
  'application/x-tex',
  'application/x-ipynb+json',
]);

/** Extensions read as plain text (code and source files, notes, data). */
const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'rst', 'csv', 'tsv', 'log', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg',
  'tex', 'bib', 'ipynb',
  'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'java', 'kt', 'kts', 'scala', 'groovy', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh',
  'cs', 'fs', 'vb', 'go', 'rs', 'rb', 'php', 'pl', 'pm', 'swift', 'm', 'mm', 'r', 'jl', 'lua', 'dart', 'hs', 'ml', 'ex', 'exs',
  'erl', 'clj', 'lisp', 'scm', 'rkt', 'pas', 'f90', 'f', 'asm', 's', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'bat',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'gd', 'pde', 'ino', 'v', 'vhd', 'vhdl', 'sv', 'proto',
  'gradle', 'cmake', 'makefile', 'dockerfile',
]);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'svg']);

function extension(name: string): string {
  const base = name.trim().toLowerCase().split(/[\\/]/).pop() ?? '';
  if (base === 'makefile' || base === 'dockerfile') return base;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1) : '';
}

function mediaType(contentType: string): string {
  return (contentType.split(';', 1)[0] ?? '').trim().toLowerCase();
}

/** How a file would be read, or why it cannot be. */
export function classifyFile(name: string, contentType: string): { kind: FileKind } | { kind: null; reason: string } {
  const type = mediaType(contentType);
  const ext = extension(name);
  if (type === 'application/pdf' || ext === 'pdf') return { kind: 'pdf' };
  if (type === DOCX || ext === 'docx') return { kind: 'docx' };
  if (type.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) {
    return { kind: null, reason: 'Images are not read: only the text of documents is sent to the AI' };
  }
  if (type === 'application/msword' || ext === 'doc') {
    return { kind: null, reason: 'Old Word (.doc) files are not read; a .docx or PDF can be' };
  }
  if (type.startsWith('text/') || TEXT_TYPES.has(type) || TEXT_EXTENSIONS.has(ext)) return { kind: 'text' };
  return { kind: null, reason: "This type of file can't be read (text documents, PDFs, Word .docx and code files can)" };
}

class Timeout extends Error {}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout()), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** Read one file's text. Never throws: failures come back as `{ ok: false, reason }`. */
export async function extractText(
  buf: Buffer,
  file: { name: string; contentType: string },
  limits: ExtractLimits = DEFAULT_EXTRACT_LIMITS,
): Promise<ExtractResult> {
  const kind = classifyFile(file.name, file.contentType);
  if (!kind.kind) return { ok: false, reason: kind.reason };
  if (buf.length > limits.maxBytes) {
    return { ok: false, reason: `The file is larger than ${Math.round(limits.maxBytes / (1024 * 1024))} MB` };
  }
  const deadline = Date.now() + limits.timeoutMs;
  try {
    switch (kind.kind) {
      case 'text':
        return textFile(buf);
      case 'docx':
        return docxFile(buf, limits.zip);
      case 'pdf':
        return await withDeadline(pdfFile(buf, limits.maxPages, deadline), limits.timeoutMs);
    }
  } catch (err) {
    if (err instanceof Timeout) return { ok: false, reason: 'The file took too long to read' };
    if (err instanceof ZipError) return { ok: false, reason: `The Word document could not be read: ${err.message}` };
    return { ok: false, reason: 'The file could not be read' };
  }
}

// ── plain text ──────────────────────────────────────────────────────────

/** UTF-8 (with or without a BOM), else Latin-1; binary files are refused. */
export function textFile(buf: Buffer): ExtractResult {
  let start = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) start = 3;
  const bytes = buf.subarray(start);
  if (bytes.includes(0)) return { ok: false, reason: 'The file is not text (it looks like a binary file)' };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = bytes.toString('latin1');
  }
  // eslint-disable-next-line no-control-regex
  const control = text.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g)?.length ?? 0;
  if (control > Math.max(8, text.length / 100)) {
    return { ok: false, reason: 'The file is not text (it looks like a binary file)' };
  }
  const clean = normalise(text);
  if (!clean.trim()) return { ok: false, reason: 'The file is empty' };
  return { ok: true, text: clean, pages: null, note: null };
}

function normalise(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
  );
}

// ── Word .docx ──────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/gi, (all, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? all;
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/**
 * The visible text of WordprocessingML: the content of `<w:t>` runs, with
 * paragraphs, line breaks, tabs and table cells as whitespace. A linear scan
 * over the tags (no backtracking regex over the document). Deleted text in
 * tracked changes (`<w:delText>`) and field codes (`<w:instrText>`) are not
 * part of the visible text and are skipped.
 */
export function wordXmlText(xml: string): string {
  let out = '';
  let i = 0;
  let inText = false;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;
    if (inText) out += decodeEntities(xml.slice(i, lt));
    const gt = xml.indexOf('>', lt + 1);
    if (gt === -1) break;
    const tag = xml.slice(lt + 1, gt);
    const closing = tag.startsWith('/');
    const name = (closing ? tag.slice(1) : tag).split(/[\s/]/, 1)[0];
    const selfClosing = tag.endsWith('/');
    if (name === 'w:t') inText = !closing && !selfClosing;
    else if (closing && name === 'w:p') out += '\n';
    else if (closing && name === 'w:tc') out += '\t';
    else if (!closing && (name === 'w:br' || name === 'w:cr')) out += '\n';
    else if (!closing && name === 'w:tab') out += '\t';
    i = gt + 1;
  }
  return out;
}

export function docxFile(buf: Buffer, zip: ZipLimits): ExtractResult {
  const xml = readZipEntry(buf, 'word/document.xml', zip);
  if (!xml) return { ok: false, reason: 'The file is not a Word document' };
  const text = normalise(wordXmlText(xml.toString('utf8')));
  if (!text.trim()) return { ok: false, reason: 'The document has no text (it may contain only images)' };
  return { ok: true, text, pages: null, note: null };
}

// ── PDF ─────────────────────────────────────────────────────────────────

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

async function pdfFile(buf: Buffer, maxPages: number, deadline: number): Promise<ExtractResult> {
  const { getDocumentProxy } = await import('unpdf');
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buf), {
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      verbosity: 0,
    } as Parameters<typeof getDocumentProxy>[1]);
  } catch (err) {
    const name = (err as { name?: string }).name ?? '';
    if (/password/i.test(name) || /password/i.test((err as Error).message ?? '')) {
      return { ok: false, reason: 'The PDF is password-protected' };
    }
    return { ok: false, reason: 'The PDF is damaged or not a PDF' };
  }
  const total = pdf.numPages;
  const read = Math.min(total, maxPages);
  const pages: string[] = [];
  let empty = 0;
  for (let n = 1; n <= read; n++) {
    if (Date.now() >= deadline) throw new Timeout();
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items as PdfTextItem[]) {
      if (typeof item.str !== 'string') continue;
      text += item.str + (item.hasEOL ? '\n' : '');
    }
    page.cleanup();
    if (!/[\p{L}\p{N}]/u.test(text)) empty++;
    pages.push(text.trim());
  }
  await pdf.cleanup().catch(() => undefined);
  const joined = normalise(pages.map((p, i) => (read > 1 ? `[Page ${i + 1}]\n${p}` : p)).join('\n\n'));
  const meaningful = joined.replace(/\[Page \d+\]/g, '').match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  if (meaningful < AI_PDF_MIN_TEXT_CHARS) {
    return {
      ok: false,
      reason: 'The PDF has no text layer (it looks scanned, handwritten or made of images), so it cannot be read',
      pages: total,
    };
  }
  const notes: string[] = [];
  if (total > read) notes.push(`only the first ${read} of ${total} pages were read`);
  if (empty > 0) notes.push(`${empty} page${empty === 1 ? '' : 's'} had no readable text (images or scans)`);
  return { ok: true, text: joined, pages: total, note: notes.length ? notes.join('; ') : null, partial: total > read };
}
