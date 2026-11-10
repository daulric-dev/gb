/**
 * Report card and transcript PDFs, drawn with pdf-lib (the maintained
 * `@pdfme/pdf-lib` fork): pure JavaScript, no native build, no browser.
 * Pure functions of their input, so they are tested without a database.
 *
 * Text is drawn in the bundled Noto Sans (Latin incl. Vietnamese, Greek,
 * Cyrillic), embedded as a subset, plus REPORT_PDF_EXTRA_FONT when set
 * (see report-fonts.ts). A character no font has is drawn as a replacement
 * character and logged once per document, so no name breaks generation.
 */

import { PDFDocument, type PDFImage, type PDFPage, rgb } from '@pdfme/pdf-lib';
import type { AttendanceSummary } from './report-card.calc';
import { type FontFace, embedDocumentFonts, reportMissing } from './report-fonts';

export interface ReportLogo {
  bytes: Uint8Array;
  type: 'png' | 'jpg';
}

export interface ReportSchool {
  name: string;
  logo: ReportLogo | null;
}

export interface ReportCourseLine {
  name: string;
  code: string | null;
  teachers: string;
  percent: number | null;
  letter: string | null;
  comment: string | null;
  /** Optional outcomes section (src/mastery), when the school shows it. */
  outcomes?: { code: string; title: string; label: string | null; mastered: boolean }[];
}

export interface ReportCardDocument {
  school: ReportSchool;
  student: { name: string };
  term: {
    name: string;
    yearName: string | null;
    startDate: string | null;
    endDate: string | null;
  };
  courses: ReportCourseLine[];
  attendance: AttendanceSummary;
  headComment: string | null;
  /** When the reports were published, or when the preview was drawn. */
  issuedAt: Date;
  /** Draws a "Preview" banner: not yet published. */
  preview?: boolean;
}

export interface TranscriptTerm {
  yearName: string | null;
  termName: string;
  startDate: string | null;
  endDate: string | null;
  courses: { name: string; code: string | null; percent: number | null; letter: string | null }[];
}

export interface TranscriptDocument {
  school: ReportSchool;
  student: { name: string };
  terms: TranscriptTerm[];
  generatedAt: Date;
}

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.82, 0.82, 0.85);
const BAND = rgb(0.95, 0.95, 0.97);

/** Break text into lines that fit `width`, keeping the author's line breaks. */
export function wrapText(font: FontFace, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.width(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A single word wider than the line is split by characters.
      let rest = word;
      while (font.width(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.width(rest.slice(0, cut), size) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
  }
  return lines;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "1 Sep 2026", in UTC. Spelled out rather than `toLocaleDateString`, whose
 * month abbreviations come from the runtime's ICU data and differ between
 * machines (newer en-GB data says "Sept"), so a printed report would change
 * with the server it was generated on.
 */
export function formatDate(value: string | Date | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatPercent(percent: number | null): string {
  if (percent === null || percent === undefined) return '-';
  return `${Number(percent).toFixed(Number.isInteger(percent) ? 0 : 1)}%`;
}

/** A page cursor that starts a new page when the next block will not fit. */
class Writer {
  page!: PDFPage;
  y = 0;
  pageNumber = 0;

  constructor(
    readonly doc: PDFDocument,
    readonly regular: FontFace,
    readonly bold: FontFace,
    private readonly footer: string,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pageNumber += 1;
    this.y = PAGE_H - MARGIN;
    const text = this.regular.safe(`${this.footer} - page ${this.pageNumber}`);
    this.regular.draw(this.page, text, { x: MARGIN, y: MARGIN / 2, size: 8, color: MUTED });
  }

  ensure(height: number) {
    if (this.y - height < MARGIN) this.newPage();
  }

  text(
    value: string,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {},
  ) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.regular;
    const x = opts.x ?? MARGIN;
    const width = opts.width ?? CONTENT_W - (x - MARGIN);
    const lines = wrapText(font, font.safe(value), size, width);
    const lineH = size * 1.35;
    for (const line of lines) {
      this.ensure(lineH);
      this.y -= lineH;
      if (line) font.draw(this.page, line, { x, y: this.y + size * 0.3, size, color: opts.color ?? INK });
    }
    this.y -= opts.gap ?? 0;
  }

  rule(gap = 8) {
    this.ensure(gap * 2);
    this.y -= gap;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.6,
      color: RULE,
    });
    this.y -= gap;
  }

  /** A row of cells at fixed x offsets, wrapping each cell; returns its height. */
  row(cells: { text: string; x: number; width: number; bold?: boolean; color?: ReturnType<typeof rgb> }[], size = 10, shade = false) {
    const lineH = size * 1.35;
    const wrapped = cells.map((c) => {
      const font = c.bold ? this.bold : this.regular;
      return { ...c, font, lines: wrapText(font, font.safe(c.text), size, c.width) };
    });
    const height = Math.max(1, ...wrapped.map((c) => c.lines.length)) * lineH + 6;
    this.ensure(height);
    if (shade) {
      this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: CONTENT_W, height, color: BAND });
    }
    for (const c of wrapped) {
      let y = this.y - 3;
      for (const line of c.lines) {
        y -= lineH;
        if (line) c.font.draw(this.page, line, { x: c.x, y: y + size * 0.3, size, color: c.color ?? INK });
      }
    }
    this.y -= height;
    return height;
  }
}

async function embedLogo(doc: PDFDocument, logo: ReportLogo | null): Promise<PDFImage | null> {
  if (!logo) return null;
  try {
    return logo.type === 'png' ? await doc.embedPng(logo.bytes) : await doc.embedJpg(logo.bytes);
  } catch {
    // A logo that will not decode is left off rather than failing the report.
    return null;
  }
}

/** School logo and name, then a title and subtitle. */
async function header(w: Writer, school: ReportSchool, title: string, subtitle: string | null) {
  const logo = await embedLogo(w.doc, school.logo);
  const top = w.y;
  let textX = MARGIN;
  if (logo) {
    const scale = Math.min(56 / logo.width, 56 / logo.height);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
    w.page.drawImage(logo, { x: MARGIN, y: top - lh, width: lw, height: lh });
    textX = MARGIN + lw + 14;
  }
  w.text(school.name, { size: 16, bold: true, x: textX });
  w.text(title, { size: 12, x: textX, color: MUTED });
  if (subtitle) w.text(subtitle, { size: 10, x: textX, color: MUTED });
  if (logo) w.y = Math.min(w.y, top - 60);
  w.rule(10);
}

/** Every string in the document's data (not the logo bytes). */
function allText(data: unknown): string {
  return JSON.stringify(data, (_key, value: unknown) => (value instanceof Uint8Array ? undefined : value));
}

async function newDocument(title: string, subject: string, data: unknown) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setSubject(subject);
  doc.setProducer('GradeBook');
  doc.setCreator('GradeBook report cards');
  const fonts = await embedDocumentFonts(doc, allText(data));
  return { doc, fonts, regular: fonts.regular, bold: fonts.bold };
}

/** One student's term report. */
export async function renderReportCard(data: ReportCardDocument): Promise<Uint8Array> {
  const title = `${data.student.name} - ${data.term.name} report`;
  const { doc, fonts, regular, bold } = await newDocument(title, `${data.school.name} term report`, data);
  doc.setCreationDate(data.issuedAt);
  doc.setModificationDate(data.issuedAt);
  const w = new Writer(doc, regular, bold, `${data.school.name} - ${data.student.name} - ${data.term.name}`);

  const dates = [formatDate(data.term.startDate), formatDate(data.term.endDate)].filter(Boolean).join(' to ');
  const termLine = [data.term.name, data.term.yearName, dates || null].filter(Boolean).join(' - ');
  await header(w, data.school, 'Term report', termLine);

  if (data.preview) {
    w.text('PREVIEW - not yet published', { size: 10, bold: true, color: rgb(0.7, 0.25, 0.1), gap: 4 });
  }

  w.text(data.student.name, { size: 14, bold: true });
  w.text(`Issued ${formatDate(data.issuedAt)}`, { size: 9, color: MUTED, gap: 8 });

  // Courses: name and teacher, grade, letter; the comment underneath.
  const colGrade = MARGIN + CONTENT_W - 120;
  const colLetter = MARGIN + CONTENT_W - 50;
  w.row(
    [
      { text: 'Course', x: MARGIN + 6, width: colGrade - MARGIN - 12, bold: true },
      { text: 'Grade', x: colGrade, width: 64, bold: true },
      { text: 'Letter', x: colLetter, width: 50, bold: true },
    ],
    10,
    true,
  );
  if (data.courses.length === 0) {
    w.text('No courses this term.', { color: MUTED, gap: 6 });
  }
  for (const course of data.courses) {
    const name = course.code ? `${course.name} (${course.code})` : course.name;
    w.row([
      { text: name, x: MARGIN + 6, width: colGrade - MARGIN - 12, bold: true },
      { text: formatPercent(course.percent), x: colGrade, width: 64 },
      { text: course.letter ?? '-', x: colLetter, width: 50, bold: true },
    ]);
    if (course.teachers) w.text(course.teachers, { size: 9, x: MARGIN + 6, color: MUTED });
    if (course.comment?.trim()) {
      w.text(course.comment.trim(), { size: 10, x: MARGIN + 6, width: CONTENT_W - 12, gap: 2 });
    }
    if (course.outcomes?.length) {
      w.text('Outcomes', { size: 9, bold: true, x: MARGIN + 6, color: MUTED });
      for (const o of course.outcomes) {
        const level = o.label ? `${o.label}${o.mastered ? ' (mastered)' : ''}` : 'Not yet assessed';
        w.row(
          [
            { text: `${o.code}  ${o.title}`, x: MARGIN + 12, width: colGrade - MARGIN - 18 },
            { text: level, x: colGrade, width: CONTENT_W - (colGrade - MARGIN) },
          ],
          9,
        );
      }
    }
    w.rule(5);
  }

  w.ensure(80);
  w.y -= 6;
  w.text('Attendance', { size: 12, bold: true, gap: 2 });
  const a = data.attendance;
  w.text(
    `Present ${a.present}   Late ${a.late}   Absent ${a.absent}   Excused ${a.excused}   (${a.total} sessions)`,
    { size: 10, gap: 8 },
  );

  if (data.headComment?.trim()) {
    w.text('Head teacher / form tutor', { size: 12, bold: true, gap: 2 });
    w.text(data.headComment.trim(), { size: 10, gap: 8 });
  }

  reportMissing(fonts, 'Report card PDF');
  return doc.save();
}

/** A student's transcript: every term, its courses, grades and letters. */
export async function renderTranscript(data: TranscriptDocument): Promise<Uint8Array> {
  const title = `${data.student.name} - transcript`;
  const { doc, fonts, regular, bold } = await newDocument(title, `${data.school.name} transcript`, data);
  doc.setCreationDate(data.generatedAt);
  doc.setModificationDate(data.generatedAt);
  const w = new Writer(doc, regular, bold, `${data.school.name} - ${data.student.name} - transcript`);

  await header(w, data.school, 'Academic transcript', `Generated ${formatDate(data.generatedAt)}`);
  w.text(data.student.name, { size: 14, bold: true, gap: 8 });

  if (data.terms.length === 0) {
    w.text('No terms to show yet.', { color: MUTED });
  }

  const colGrade = MARGIN + CONTENT_W - 120;
  const colLetter = MARGIN + CONTENT_W - 50;
  for (const term of data.terms) {
    w.ensure(60);
    const heading = [term.yearName, term.termName].filter(Boolean).join(' - ');
    w.text(heading, { size: 12, bold: true, gap: 2 });
    w.row(
      [
        { text: 'Course', x: MARGIN + 6, width: colGrade - MARGIN - 12, bold: true },
        { text: 'Grade', x: colGrade, width: 64, bold: true },
        { text: 'Letter', x: colLetter, width: 50, bold: true },
      ],
      9,
      true,
    );
    for (const c of term.courses) {
      w.row(
        [
          { text: c.code ? `${c.name} (${c.code})` : c.name, x: MARGIN + 6, width: colGrade - MARGIN - 12 },
          { text: formatPercent(c.percent), x: colGrade, width: 64 },
          { text: c.letter ?? '-', x: colLetter, width: 50, bold: true },
        ],
        9,
      );
    }
    w.y -= 10;
  }

  reportMissing(fonts, 'Transcript PDF');
  return doc.save();
}

/** The logo's type from its leading bytes; null for anything pdf-lib cannot embed (see report-logo.ts for WebP). */
export function logoType(bytes: Uint8Array): ReportLogo['type'] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}
