import writeXlsxFile from 'write-excel-file/node';
import type { Cell, Row, SheetData } from 'write-excel-file/node';
import type { StudentYearResult as StudentYearReport } from '@/calculation/interfaces/calculation.interfaces';
import { getGradingRules } from './grading-rules';

function fmt(v: number | null): string {
  return v != null ? v.toFixed(1) : '';
}

function termInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

function r2(v: number | null): number | null {
  return v != null ? Math.round(v * 100) / 100 : null;
}

function r1(v: number | null): number | null {
  return v != null ? Math.round(v * 10) / 10 : null;
}

function collectSubjectCols(students: StudentYearReport[]) {
  const seen = new Set<string>();
  const cols: { id: string; name: string }[] = [];
  for (const st of students) {
    for (const sub of st.yearEnd.subjects) {
      if (!seen.has(sub.subjectId)) {
        seen.add(sub.subjectId);
        cols.push({ id: sub.subjectId, name: sub.subjectName });
      }
    }
  }
  return cols;
}

export function buildYearClassSummaryCsvBuffer(
  students: StudentYearReport[],
  className: string,
  opts: {
    academicYearName?: string;
    yearCwWeight?: number;
    yearExWeight?: number;
  } = {},
): Buffer {
  const lines: string[] = [];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;

  lines.push('Year-End Class Summary Report');
  lines.push(`Class,${esc(className)}`);
  if (opts.academicYearName)
    lines.push(`Academic Year,${esc(opts.academicYearName)}`);
  if (opts.yearCwWeight != null)
    lines.push(`Year Coursework Weight,${opts.yearCwWeight}%`);
  if (opts.yearExWeight != null)
    lines.push(`Year Exam Weight,${opts.yearExWeight}%`);
  lines.push(`Total Students,${students.length}`);

  const overalls = students
    .map((s) => s.yearEnd.overallAverage)
    .filter((a): a is number => a != null);
  if (overalls.length > 0) {
    const avg = overalls.reduce((s, v) => s + v, 0) / overalls.length;
    lines.push(`Class Average,${avg.toFixed(2)}`);
  }
  lines.push('');

  const subjectCols = collectSubjectCols(students);
  const termNames = students[0]?.terms.map((t) => t.termName) ?? [];
  const termInitials = termNames.map(termInitial);
  const termIds = students[0]?.terms.map((t) => t.termId) ?? [];

  const lastTermId = termIds.length > 0 ? termIds[termIds.length - 1] : null;

  const rules = getGradingRules(students[0]?.gradingModel);
  const isPooled = rules.display.yearEndColumns === 'pooled';
  const cwW = students[0]?.yearCourseworkWeight ?? opts.yearCwWeight ?? 40;
  const exW = students[0]?.yearExamWeight ?? opts.yearExWeight ?? 60;

  if (students.length > 0 && subjectCols.length > 0) {
    lines.push('Student Year Grades');

    const subHeadersPerSubject = isPooled
      ? [`CA /${cwW}`, `Exam /${exW}`, 'Total']
      : [...termInitials, 'E', 'Year'];

    const groupRow = [
      '',
      '',
      ...subjectCols.flatMap((c) => [
        esc(c.name),
        ...Array.from({ length: subHeadersPerSubject.length - 1 }, () => ''),
      ]),
      '',
    ];
    lines.push(groupRow.join(','));

    const subRow = [
      'Position',
      'Student',
      ...subjectCols.flatMap(() => subHeadersPerSubject),
      'Year Average',
    ];
    lines.push(subRow.map(esc).join(','));

    for (const st of students) {
      const subMap = new Map(st.yearEnd.subjects.map((s) => [s.subjectId, s]));
      const lastTerm = lastTermId
        ? st.terms.find((t) => t.termId === lastTermId)
        : undefined;
      const lastTermExamMap = new Map<string, number | null>();
      if (lastTerm) {
        for (const s of lastTerm.subjects) {
          lastTermExamMap.set(s.subjectId, s.examAverage);
        }
      }

      const row = [
        st.position != null ? String(st.position) : '',
        esc(`${st.firstName} ${st.lastName}`.trim()),
        ...subjectCols.flatMap((c) => {
          const sub = subMap.get(c.id);

          if (isPooled) {
            const composites = (sub?.termGrades ?? [])
              .map((g) => g.termComposite)
              .filter((v): v is number => v != null);
            const rawCa =
              composites.length > 0
                ? composites.reduce((a, b) => a + b, 0) / composites.length
                : null;
            const ca = rawCa != null ? fmt((rawCa * cwW) / 100) : '';
            const endOfYrExam = lastTermExamMap.get(c.id) ?? null;
            const exam =
              endOfYrExam != null ? fmt((endOfYrExam * exW) / 100) : '';
            return [ca, exam, fmt(sub?.yearGrade ?? null)];
          }

          const termScores = termIds.map((tid) => {
            const tg = sub?.termGrades.find((g) => g.termId === tid);
            return fmt(tg?.termComposite ?? null);
          });
          const endOfYrExam = lastTermExamMap.get(c.id) ?? null;
          return [...termScores, fmt(endOfYrExam), fmt(sub?.yearGrade ?? null)];
        }),
        st.yearEnd.overallAverage != null
          ? st.yearEnd.overallAverage.toFixed(2)
          : '',
      ];
      lines.push(row.join(','));
    }
  }

  return Buffer.from(lines.join('\n'), 'utf-8');
}

export function buildYearClassSummaryXlsxBuffer(
  students: StudentYearReport[],
  className: string,
  opts: {
    academicYearName?: string;
    yearCwWeight?: number;
    yearExWeight?: number;
  } = {},
): Promise<Buffer> {
  const summaryRows: (string | number | null)[][] = [
    ['Year-End Class Summary Report'],
    ['Class', className],
  ];
  if (opts.academicYearName)
    summaryRows.push(['Academic Year', opts.academicYearName]);
  if (opts.yearCwWeight != null)
    summaryRows.push(['Year Coursework Weight', `${opts.yearCwWeight}%`]);
  if (opts.yearExWeight != null)
    summaryRows.push(['Year Exam Weight', `${opts.yearExWeight}%`]);
  summaryRows.push(['Total Students', students.length]);

  const overalls = students
    .map((s) => s.yearEnd.overallAverage)
    .filter((a): a is number => a != null);
  if (overalls.length > 0) {
    const avg = overalls.reduce((s, v) => s + v, 0) / overalls.length;
    summaryRows.push(['Class Average', r2(avg)]);
  }

  const summaryColumns = [{ width: 24 }, { width: 14 }];

  const subjectCols = collectSubjectCols(students);
  const termNames = students[0]?.terms.map((t) => t.termName) ?? [];
  const termInitials = termNames.map(termInitial);
  const termIds = students[0]?.terms.map((t) => t.termId) ?? [];

  const lastTermId = termIds.length > 0 ? termIds[termIds.length - 1] : null;

  const xlsxRules = getGradingRules(students[0]?.gradingModel);
  const isPooledXlsx = xlsxRules.display.yearEndColumns === 'pooled';
  const cwWXlsx = students[0]?.yearCourseworkWeight ?? opts.yearCwWeight ?? 40;
  const exWXlsx = students[0]?.yearExamWeight ?? opts.yearExWeight ?? 60;

  const subHeadersXlsx = isPooledXlsx
    ? [`CA /${cwWXlsx}`, `Exam /${exWXlsx}`, 'Total']
    : [...termInitials, 'E', 'Year'];
  const colsPerSubject = subHeadersXlsx.length;

  // The subject name cell spans its sub-columns; the trailing `null`s are the
  // cells covered by the span (write-excel-file's merge convention).
  const groupRow: Row = [
    '',
    '',
    ...subjectCols.flatMap((c): Cell[] => [
      { value: c.name, columnSpan: colsPerSubject },
      ...Array.from({ length: colsPerSubject - 1 }, () => null),
    ]),
    '',
  ];
  const subRow: (string | null)[] = [
    'Position',
    'Student',
    ...subjectCols.flatMap(() => subHeadersXlsx),
    'Year Average',
  ];
  const studentRows: SheetData = [groupRow, subRow];

  for (const st of students) {
    const subMap = new Map(st.yearEnd.subjects.map((s) => [s.subjectId, s]));
    const lastTerm = lastTermId
      ? st.terms.find((t) => t.termId === lastTermId)
      : undefined;
    const lastTermExamMap = new Map<string, number | null>();
    if (lastTerm) {
      for (const s of lastTerm.subjects) {
        lastTermExamMap.set(s.subjectId, s.examAverage);
      }
    }

    studentRows.push([
      st.position ?? null,
      `${st.firstName} ${st.lastName}`.trim(),
      ...subjectCols.flatMap((c) => {
        const sub = subMap.get(c.id);

        if (isPooledXlsx) {
          const composites = (sub?.termGrades ?? [])
            .map((g) => g.termComposite)
            .filter((v): v is number => v != null);
          const rawCa =
            composites.length > 0
              ? composites.reduce((a, b) => a + b, 0) / composites.length
              : null;
          const ca = rawCa != null ? r1((rawCa * cwWXlsx) / 100) : null;
          const endOfYrExam = lastTermExamMap.get(c.id) ?? null;
          const exam =
            endOfYrExam != null ? r1((endOfYrExam * exWXlsx) / 100) : null;
          return [ca, exam, r1(sub?.yearGrade ?? null)];
        }

        const termScores = termIds.map((tid) => {
          const tg = sub?.termGrades.find((g) => g.termId === tid);
          return r1(tg?.termComposite ?? null);
        });
        const endOfYrExam = lastTermExamMap.get(c.id) ?? null;
        return [...termScores, r1(endOfYrExam), r1(sub?.yearGrade ?? null)];
      }),
      r2(st.yearEnd.overallAverage),
    ]);
  }

  const studentColumns = [
    { width: 10 },
    { width: 28 },
    ...subjectCols.flatMap(() =>
      Array.from({ length: colsPerSubject }, () => ({ width: 12 })),
    ),
    { width: 16 },
  ];

  return writeXlsxFile([
    {
      data: summaryRows,
      sheet: 'Summary',
      columns: summaryColumns,
    },
    {
      data: studentRows,
      sheet: 'Students',
      columns: studentColumns,
    },
  ]).toBuffer();
}
