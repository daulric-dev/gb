import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { PDFDict, PDFDocument, PDFName, StandardFonts } from '@pdfme/pdf-lib';
import { pdfFontNames, pdfText } from '@/test/pdf-text';
import { FontFace, resetFontCache } from './report-fonts';
import { isWebp, logoForPdf, sharpToPng } from './report-logo';
import {
  formatDate,
  type ReportCardDocument,
  formatPercent,
  logoType,
  renderReportCard,
  renderTranscript,
} from './report-pdf';

// A 1x1 transparent PNG.
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

function report(over: Partial<ReportCardDocument> = {}): ReportCardDocument {
  return {
    school: { name: 'Hillside Academy', logo: { bytes: PNG, type: 'png' } },
    student: { name: 'Ada Lovelace' },
    term: { name: 'Autumn', yearName: '2026-27', startDate: '2026-09-01', endDate: '2026-12-15' },
    courses: [
      {
        name: 'Mathematics',
        code: 'MA1',
        teachers: 'Mr Babbage',
        percent: 87.5,
        letter: 'B',
        comment: 'Excellent progress with proofs.',
      },
      { name: 'Art', code: null, teachers: '', percent: null, letter: null, comment: null },
    ],
    attendance: { present: 40, late: 2, absent: 3, excused: 1, total: 46 },
    headComment: 'A thoughtful and kind member of the form.',
    issuedAt: new Date('2026-12-18T10:00:00Z'),
    ...over,
  };
}

describe('formatDate', () => {
  test('uses fixed month abbreviations, not the runtime locale data', () => {
    expect(formatDate('2026-09-01T00:00:00Z')).toBe('1 Sep 2026');
    expect(formatDate('2026-12-15T23:59:00Z')).toBe('15 Dec 2026');
    expect(formatDate(null)).toBeNull();
    expect(formatDate('not a date')).toBeNull();
  });
});

describe('renderReportCard', () => {
  test('is a valid PDF that pdf-lib can load again', async () => {
    const bytes = await renderReportCard(report());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('Ada Lovelace - Autumn report');
  });

  test('contains the school, student, term, courses, grades, comments, attendance and head comment', async () => {
    const text = await pdfText(await renderReportCard(report()));
    for (const expected of [
      'Hillside Academy',
      'Ada Lovelace',
      'Autumn - 2026-27 - 1 Sep 2026 to 15 Dec 2026',
      'Mathematics (MA1)',
      '87.5%',
      'B',
      'Mr Babbage',
      'Excellent progress with proofs.',
      'Art',
      'Present 40 Late 2 Absent 3 Excused 1 (46 sessions)',
      'A thoughtful and kind member of the form.',
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain('PREVIEW');
  });

  test('a preview says so', async () => {
    const text = await pdfText(await renderReportCard(report({ preview: true })));
    expect(text).toContain('PREVIEW - not yet published');
  });

  test('long comments wrap onto more pages instead of running off the page', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      name: `Course ${i}`,
      code: null,
      teachers: 'Teacher',
      percent: 70,
      letter: 'C',
      comment: 'Lorem ipsum dolor sit amet '.repeat(12),
    }));
    const bytes = await renderReportCard(report({ courses: many }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(await pdfText(bytes)).toContain('Course 29');
  });

  test('names in Latin (extended), Greek, Cyrillic and Vietnamese are drawn as written', async () => {
    const names = ['Zoë Ångström', 'Dmitri Иванов', 'Nguyễn Thị Minh Khai', 'Σωκράτης Παπαδόπουλος', 'Łukasz Żółć', 'Şükrü Öztürk'];
    const bytes = await renderReportCard(
      report({
        student: { name: names.join(' / ') },
        school: { name: 'École Saint-Étienne', logo: null },
        headComment: names.join('\n'),
      }),
    );
    const text = await pdfText(bytes);
    for (const name of names) expect(text).toContain(name);
    expect(text).toContain('École Saint-Étienne');
    expect(text).not.toContain('\uFFFD');
    // Embedded, subset Noto Sans; no standard font.
    const fonts = await pdfFontNames(bytes);
    expect(fonts.some((f) => f.startsWith('NotoSans-Regular'))).toBe(true);
    expect(fonts.some((f) => f.startsWith('NotoSans-Bold'))).toBe(true);
    expect(fonts.some((f) => f.startsWith('Helvetica'))).toBe(false);
    // Subsetting keeps the file small (the full fonts are ~430 KB each).
    expect(bytes.length).toBeLessThan(60_000);
  });

  test('a name written decomposed (e + combining mark) is drawn composed', async () => {
    const text = await pdfText(await renderReportCard(report({ student: { name: 'Zoe\u0308 Nguye\u0302\u0303n' } })));
    expect(text).toContain('Zoë Nguyễn');
  });

  test('characters no font covers (CJK, Arabic) are replaced, logged once, never fatal', async () => {
    const warn = spyOn(Logger.prototype, 'warn');
    try {
      const bytes = await renderReportCard(
        report({ student: { name: 'Zoë 李雷 محمد' }, headComment: '李雷 is doing well.' }),
      );
      const text = await pdfText(bytes);
      expect(text).toContain('Zoë \uFFFD\uFFFD \uFFFD\uFFFD\uFFFD\uFFFD');
      const logs = warn.mock.calls.filter((c) => String(c[0]).startsWith('Report card PDF:'));
      expect(logs).toHaveLength(1);
      expect(String(logs[0][0])).toContain('REPORT_PDF_EXTRA_FONT');
    } finally {
      warn.mockRestore();
    }
  });

  test('an unreadable logo is left off rather than failing', async () => {
    const bytes = await renderReportCard(
      report({ school: { name: 'Hillside Academy', logo: { bytes: new Uint8Array([1, 2, 3]), type: 'png' } } }),
    );
    expect(await pdfText(bytes)).toContain('Hillside Academy');
  });
});

describe('renderTranscript', () => {
  test('lists every term with its courses, grades and letters', async () => {
    const bytes = await renderTranscript({
      school: { name: 'Hillside Academy', logo: null },
      student: { name: 'Ada Lovelace' },
      generatedAt: new Date('2027-07-01T00:00:00Z'),
      terms: [
        {
          yearName: '2026-27',
          termName: 'Autumn',
          startDate: null,
          endDate: null,
          courses: [{ name: 'Mathematics', code: 'MA1', percent: 87.5, letter: 'B' }],
        },
        {
          yearName: '2026-27',
          termName: 'Spring',
          startDate: null,
          endDate: null,
          courses: [{ name: 'Physics', code: null, percent: 92, letter: 'A' }],
        },
      ],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe('Ada Lovelace - transcript');
    const text = await pdfText(bytes);
    for (const expected of ['Academic transcript', '2026-27 - Autumn', 'Mathematics (MA1)', '87.5%', '2026-27 - Spring', 'Physics', '92%', 'A']) {
      expect(text).toContain(expected);
    }
  });
});

// A system font with CJK glyphs, where the machine has one (macOS, Debian/Ubuntu).
const WIDE_FONT = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
  '/usr/share/fonts/truetype/arphic/uming.ttf',
].find((p) => existsSync(p));

describe('REPORT_PDF_EXTRA_FONT', () => {
  const saved = process.env.REPORT_PDF_EXTRA_FONT;
  afterEach(() => {
    if (saved === undefined) delete process.env.REPORT_PDF_EXTRA_FONT;
    else process.env.REPORT_PDF_EXTRA_FONT = saved;
    resetFontCache();
  });

  test.skipIf(!WIDE_FONT)('draws what Noto Sans lacks with the extra font, embedded only when needed', async () => {
    process.env.REPORT_PDF_EXTRA_FONT = WIDE_FONT!;
    const cjk = await renderReportCard(report({ student: { name: 'Zoë 李雷' } }));
    // Each font run is its own Tj.
    expect(await pdfText(cjk)).toContain('Zoë \n李雷');
    expect((await pdfFontNames(cjk)).length).toBe(3);

    const latin = await renderReportCard(report());
    expect((await pdfFontNames(latin)).length).toBe(2);
  });

  test('a missing extra font is logged and ignored', async () => {
    process.env.REPORT_PDF_EXTRA_FONT = '/nonexistent/font.ttf';
    const text = await pdfText(await renderReportCard(report({ student: { name: 'Zoë 李' } })));
    expect(text).toContain('Zoë \uFFFD');
  });
});

describe('FontFace', () => {
  /** A stand-in PDFFont: a set of code points, 1 unit wide per character. */
  const fake = (chars: string) =>
    ({
      getCharacterSet: () => [...chars].map((c) => c.codePointAt(0)!),
      widthOfTextAtSize: (t: string, size: number) => [...t].length * size,
    }) as any;

  test('splits text into runs by the font that has each glyph', () => {
    const primary = fake('abc \uFFFD');
    const extra = fake('李雷');
    const face = new FontFace(primary, extra, new Set(), false);
    const safe = face.safe('ab 李雷 c 💥');
    expect(safe).toBe('ab 李雷 c \uFFFD');
    expect(face.runs(safe).map((r) => [r.text, r.font === extra])).toEqual([
      ['ab ', false],
      ['李雷', true],
      [' c \uFFFD', false],
    ]);
    expect(face.width(safe, 10)).toBe(90);
  });

  test('with the standard fonts (fonts missing), folds to Latin or replaces with "?"', async () => {
    const doc = await PDFDocument.create();
    const missing = new Set<string>();
    const face = new FontFace(await doc.embedFont(StandardFonts.Helvetica), null, missing, true);
    expect(face.safe('Zoë Łukasz 李雷')).toBe('Zoë Lukasz ??');
    expect([...missing]).toEqual(['李', '雷']);
  });
});

describe('helpers', () => {
  test('logoType reads PNG and JPEG signatures only', () => {
    expect(logoType(PNG)).toBe('png');
    expect(logoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(logoType(new TextEncoder().encode('RIFF....WEBP'))).toBeNull();
  });

  test('formatPercent', () => {
    expect(formatPercent(null)).toBe('-');
    expect(formatPercent(90)).toBe('90%');
    expect(formatPercent(87.25)).toBe('87.3%');
  });
});

describe('school logos', () => {
  // Generated with sharp: a 4x3 lossless WebP and a 4x3 lossy one.
  const WEBP_LOSSLESS = Uint8Array.from(Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvA4AAAAdQjyKXp/+BiOh/AAA=', 'base64'));
  const WEBP_LOSSY = Uint8Array.from(
    Buffer.from('UklGRjYAAABXRUJQVlA4ICoAAACQAQCdASoEAAMAAUAmJaACdLoAA5gA/vBTH832PZ4P/n5n+6f536JAAAA=', 'base64'),
  );
  const imageCount = async (bytes: Uint8Array) => {
    const doc = await PDFDocument.load(bytes);
    return doc.getPages().reduce((n, p) => {
      const xobjects = p.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
      return n + (xobjects?.keys().length ?? 0);
    }, 0);
  };

  test('PNG and JPEG are used as they are', async () => {
    expect(await logoForPdf(PNG)).toEqual({ bytes: PNG, type: 'png' });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    expect((await logoForPdf(jpg))?.type).toBe('jpg');
  });

  test('a WebP logo is converted to PNG and embedded', async () => {
    expect(isWebp(WEBP_LOSSLESS)).toBe(true);
    const convert = mock(async () => async () => PNG);
    const logo = await logoForPdf(WEBP_LOSSLESS, convert);
    expect(logo).toEqual({ bytes: PNG, type: 'png' });
    const bytes = await renderReportCard(report({ school: { name: 'Hillside Academy', logo } }));
    expect(await imageCount(bytes)).toBe(1);
  });

  test('with the real converter: sharp converts it when installed, else the logo is left off and logged', async () => {
    const toPng = await sharpToPng();
    for (const webp of [WEBP_LOSSLESS, WEBP_LOSSY]) {
      const logo = await logoForPdf(webp);
      if (toPng) {
        expect(logo?.type).toBe('png');
        expect(await imageCount(await renderReportCard(report({ school: { name: 'H', logo } })))).toBe(1);
      } else {
        expect(logo).toBeNull();
      }
    }
  });

  test('a failed conversion, or an unknown format, leaves the logo off and the report renders', async () => {
    const warn = spyOn(Logger.prototype, 'warn');
    try {
      const broken = await logoForPdf(WEBP_LOSSY, async () => async () => {
        throw new Error('corrupt');
      });
      expect(broken).toBeNull();
      expect(warn.mock.calls.some((c) => String(c[0]).includes('WebP conversion failed (corrupt)'))).toBe(true);
      // A converter that does not return a PNG is refused too.
      expect(await logoForPdf(WEBP_LOSSY, async () => async () => new Uint8Array([1, 2, 3]))).toBeNull();
      expect(await logoForPdf(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
      const bytes = await renderReportCard(report({ school: { name: 'Hillside Academy', logo: null } }));
      expect(await imageCount(bytes)).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });
});
