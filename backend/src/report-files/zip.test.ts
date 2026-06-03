import { describe, test, expect } from 'bun:test';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import { ReportFilesService } from './report-files.service';
import { createMockSupabaseService } from '@/test/mocks';
import type { StudentTermResult } from '@/calculation/interfaces/calculation.interfaces';

function student(first: string, last: string): StudentTermResult {
  return {
    studentId: `${first}-${last}`,
    firstName: first,
    lastName: last,
    termId: 't1',
    subjects: [
      {
        subjectId: 'm',
        subjectName: 'Math',
        subjectCode: null,
        isGraded: true,
        courseworkAverage: 70,
        examAverage: 80,
        termComposite: 75,
        gradeCount: 1,
        assessments: [],
      },
    ],
    overallAverage: 75,
    position: 1,
  };
}

const contextRow = {
  name: '5A',
  coursework_weight: 60,
  exam_weight: 40,
  academic_year_id: 'ay1',
  grading_model: 'weighted_continuous',
  year_coursework_weight: 40,
  year_exam_weight: 60,
};

function makeService(classResults: StudentTermResult[]) {
  const supabase = createMockSupabaseService({
    queryResult: { data: contextRow, error: null },
  });
  const calc = {
    calculateClassTermResults: () => Promise.resolve(classResults),
    calculateClassYearResults: () => Promise.resolve([]),
  };
  return new ReportFilesService(supabase as any, calc as any, {} as any);
}

// Count zip local-file-header signatures (PK\x03\x04) == entry count.
function countZipEntries(buf: Buffer): number {
  let count = 0;
  for (let i = 0; i + 3 < buf.length; i++) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x03 &&
      buf[i + 3] === 0x04
    ) {
      count += 1;
    }
  }
  return count;
}

describe('prepareClassZip', () => {
  test('plans entries with deduped filenames and lazy PDF render', async () => {
    // Two students sharing a name -> filenames must not collide.
    const service = makeService([
      student('John', 'Doe'),
      student('John', 'Doe'),
    ]);
    const { zipFilename, entries } = await service.prepareClassZip(
      'g1',
      't1',
      'term',
    );
    expect(zipFilename).toBe('5A_reports.zip');
    expect(entries.length).toBe(2);
    expect(entries[0].filename).toBe('John_Doe_report.pdf');
    expect(entries[1].filename).toBe('John_Doe_report_2.pdf');

    const pdf = entries[0].render();
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('archiver streams all entries into a valid zip', async () => {
    const service = makeService([student('A', 'One'), student('B', 'Two')]);
    const { entries } = await service.prepareClassZip('g1', 't1', 'term');

    const archive = archiver('zip', { zlib: { level: 6 } });
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<void>((resolve) =>
      sink.on('end', () => resolve()),
    );
    archive.pipe(sink);

    for (const e of entries) archive.append(e.render(), { name: e.filename });
    await archive.finalize();
    await done;

    const zip = Buffer.concat(chunks);
    expect(zip[0]).toBe(0x50); // 'P'
    expect(zip[1]).toBe(0x4b); // 'K'
    expect(countZipEntries(zip)).toBe(2);
  });
});
