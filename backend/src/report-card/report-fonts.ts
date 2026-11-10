/**
 * Fonts for report card and transcript PDFs.
 *
 * Bundled: Noto Sans Regular and Bold (SIL Open Font License 1.1, see
 * `fonts/README.md` and `fonts/OFL.txt`), which cover Latin (with the
 * extended and Vietnamese letters), Greek and Cyrillic. They are embedded
 * with fontkit and subset, so a PDF carries only the glyphs it uses.
 *
 * Optional: `REPORT_PDF_EXTRA_FONT`, the path to one more TrueType/OpenType
 * font (for example a Noto Sans CJK or Noto Naskh Arabic file) used for
 * characters Noto Sans lacks. It is embedded only in documents that need it.
 *
 * Anything neither font covers is drawn as a replacement character, and the
 * document logs it once. If the bundled fonts cannot be read (a broken
 * build), the PDF falls back to the standard Helvetica fonts, which cover
 * Windows-1252 only: other characters are folded to Latin or replaced.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import * as fontkit from 'fontkit';
import {
  type PDFDocument,
  type PDFFont,
  type PDFPage,
  StandardFonts,
  type RGB,
} from '@pdfme/pdf-lib';

const logger = new Logger('ReportPdfFonts');

export const FONT_DIR = join(__dirname, 'fonts');
export const REGULAR_FONT = 'NotoSans-Regular.ttf';
export const BOLD_FONT = 'NotoSans-Bold.ttf';

/** What fontkit gives us about a font file: its bytes and code points. */
interface FontFile {
  bytes: Uint8Array;
  characters: Set<number>;
}

function readFont(path: string): FontFile {
  const bytes = new Uint8Array(readFileSync(path));
  const parsed = fontkit.create(Buffer.from(bytes)) as unknown as { characterSet?: number[] };
  if (!parsed?.characterSet) throw new Error('not a single TrueType/OpenType font');
  return { bytes, characters: new Set(parsed.characterSet) };
}

let bundled: { regular: FontFile; bold: FontFile } | null | undefined;

/** The bundled Noto Sans files, read once; null if they are missing. */
export function bundledFonts(): { regular: FontFile; bold: FontFile } | null {
  if (bundled !== undefined) return bundled;
  try {
    bundled = {
      regular: readFont(join(FONT_DIR, REGULAR_FONT)),
      bold: readFont(join(FONT_DIR, BOLD_FONT)),
    };
  } catch (error) {
    logger.error(
      `Report PDF fonts missing from ${FONT_DIR} (${(error as Error).message}); using Helvetica, which shows Latin text only`,
    );
    bundled = null;
  }
  return bundled;
}

const extraCache = new Map<string, FontFile | null>();

/** REPORT_PDF_EXTRA_FONT, read once per path; null when unset or unreadable. */
export function extraFont(path = process.env.REPORT_PDF_EXTRA_FONT?.trim()): FontFile | null {
  if (!path) return null;
  if (extraCache.has(path)) return extraCache.get(path)!;
  let font: FontFile | null = null;
  try {
    if (!existsSync(path)) throw new Error('file not found');
    font = readFont(path);
  } catch (error) {
    logger.error(`REPORT_PDF_EXTRA_FONT ${path} not used: ${(error as Error).message}`);
  }
  extraCache.set(path, font);
  return font;
}

/** Test hook: forget cached fonts. */
export function resetFontCache() {
  bundled = undefined;
  extraCache.clear();
}

/** Latin letters with no decomposition to fold through (Helvetica fallback). */
const LATIN_FOLDS: Record<string, string> = {
  Ł: 'L',
  ł: 'l',
  Đ: 'D',
  đ: 'd',
  Ħ: 'H',
  ħ: 'h',
  ı: 'i',
  Ŧ: 'T',
  ŧ: 't',
};

const REPLACEMENT = '\uFFFD';
const NO_DECOMPOSE = { ccmp: false };

/**
 * One weight's font for a document: the primary font and, when the
 * document needs it, the extra font for what the primary lacks. Text is
 * measured and drawn in runs, each with the font that has its glyphs.
 */
export class FontFace {
  private readonly primarySet: Set<number>;
  private readonly fallbackSet: Set<number>;
  private readonly replacement: string;

  constructor(
    readonly primary: PDFFont,
    readonly fallback: PDFFont | null,
    private readonly missing: Set<string>,
    /** Standard 14 font: fold accents to Latin before replacing. */
    private readonly standard: boolean,
  ) {
    this.primarySet = new Set(primary.getCharacterSet());
    this.fallbackSet = new Set(fallback?.getCharacterSet() ?? []);
    this.replacement = this.primarySet.has(REPLACEMENT.codePointAt(0)!) ? REPLACEMENT : '?';
  }

  private has(cp: number) {
    return this.primarySet.has(cp) || this.fallbackSet.has(cp);
  }

  /** Text every character of which one of the fonts can draw. */
  safe(text: string): string {
    let out = '';
    // NFC: a decomposed "e" + combining mark becomes the precomposed letter.
    const normalized = text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
    for (const ch of normalized) {
      const cp = ch.codePointAt(0)!;
      if (ch === '\n' || this.has(cp)) {
        out += ch;
        continue;
      }
      // Helvetica: fold to the closest Latin letter (accents dropped).
      if (this.standard) {
        const folded = (LATIN_FOLDS[ch] ?? ch).normalize('NFKD').replace(/[̀-ͯ]/g, '');
        if (folded && [...folded].every((c) => this.has(c.codePointAt(0)!))) {
          out += folded;
          continue;
        }
      }
      if (!/\p{M}|\p{Cc}|\p{Cf}/u.test(ch)) this.missing.add(ch);
      if (!/\p{M}|\p{Cf}/u.test(ch)) out += this.replacement;
    }
    return out;
  }

  /** Runs of text that one font draws. `text` must already be `safe`. */
  runs(text: string): { text: string; font: PDFFont }[] {
    if (!this.fallback) return text ? [{ text, font: this.primary }] : [];
    const out: { text: string; font: PDFFont }[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      const font = this.primarySet.has(cp) || !this.fallbackSet.has(cp) ? this.primary : this.fallback;
      const last = out[out.length - 1];
      if (last && last.font === font) last.text += ch;
      else out.push({ text: ch, font });
    }
    return out;
  }

  width(text: string, size: number): number {
    return this.runs(text).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);
  }

  draw(page: PDFPage, text: string, opts: { x: number; y: number; size: number; color: RGB }) {
    let x = opts.x;
    for (const run of this.runs(text)) {
      page.drawText(run.text, { x, y: opts.y, size: opts.size, font: run.font, color: opts.color });
      x += run.font.widthOfTextAtSize(run.text, opts.size);
    }
  }
}

export interface DocumentFonts {
  regular: FontFace;
  bold: FontFace;
  /** Characters no font had, replaced; log with `reportMissing`. */
  missing: Set<string>;
}

/**
 * Embed the fonts a document needs: Noto Sans (subset), plus the extra font
 * when `text` has characters Noto lacks and the extra font has.
 */
export async function embedDocumentFonts(doc: PDFDocument, text: string): Promise<DocumentFonts> {
  const missing = new Set<string>();
  const files = bundledFonts();
  if (!files) {
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return {
      regular: new FontFace(regular, null, missing, true),
      bold: new FontFace(bold, null, missing, true),
      missing,
    };
  }

  doc.registerFontkit(fontkit as never);
  // pdf-lib draws glyphs without positioning marks, so keep precomposed
  // letters whole (no ccmp decomposition into base + mark).
  const regular = await doc.embedFont(files.regular.bytes, { subset: true, features: NO_DECOMPOSE });
  const bold = await doc.embedFont(files.bold.bytes, { subset: true, features: NO_DECOMPOSE });

  let fallback: PDFFont | null = null;
  const extra = extraFont();
  if (extra) {
    const needs = [...text].some((ch) => {
      const cp = ch.codePointAt(0)!;
      return !files.regular.characters.has(cp) && extra.characters.has(cp);
    });
    if (needs) fallback = await doc.embedFont(extra.bytes, { subset: true, features: NO_DECOMPOSE });
  }

  return {
    regular: new FontFace(regular, fallback, missing, false),
    bold: new FontFace(bold, fallback, missing, false),
    missing,
  };
}

/** Log, once per document, the characters that were replaced. */
export function reportMissing(fonts: DocumentFonts, what: string) {
  if (fonts.missing.size === 0) return;
  const sample = [...fonts.missing].slice(0, 12).join(' ');
  logger.warn(
    `${what}: ${fonts.missing.size} character(s) not in the PDF fonts were replaced (${sample}). ` +
      'Set REPORT_PDF_EXTRA_FONT to a font that covers them.',
  );
}
