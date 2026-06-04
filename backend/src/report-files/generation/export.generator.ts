import writeXlsxFile from 'write-excel-file/node';
import type { Cell, Row, SheetData } from 'write-excel-file/node';
import type { ClassSummary } from './class-summary.transform';
import { getGradingRules } from './grading-rules';

function collectSubjectCols(summary: ClassSummary) {
  const seen = new Set<string>();
  const cols: { id: string; name: string }[] = [];
  for (const st of summary.students) {
    for (const s of st.subjects) {
      if (!seen.has(s.subjectId)) {
        seen.add(s.subjectId);
        cols.push({ id: s.subjectId, name: s.subjectName });
      }
    }
  }
  return cols;
}

const num = (v: number | null) => (v != null ? v.toFixed(1) : '');

export function buildClassSummaryCsvBuffer(
  summary: ClassSummary,
  className: string,
  reportType?: string,
  termName?: string,
  gradingModel?: string,
): Buffer {
  const lines: string[] = [];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const isYearEnd = reportType === 'year_end';
  const csvRules = getGradingRules(gradingModel);
  const hasTermExam = csvRules.termHasExam || isYearEnd;
  const weightLabel = isYearEnd ? 'Year' : 'Term';

  lines.push(`Class Summary Report`);
  lines.push(`Class,${esc(className)}`);
  if (termName) lines.push(`Term,${esc(termName)}`);
  lines.push(`${weightLabel} Coursework Weight,${summary.courseworkWeight}%`);
  lines.push(`${weightLabel} Exam Weight,${summary.examWeight}%`);
  lines.push(`Total Students,${summary.totalStudents}`);
  lines.push(
    `Class Average,${summary.classAverage != null ? summary.classAverage.toFixed(2) : ''}`,
  );
  lines.push(
    `Highest Average,${summary.highestAverage != null ? summary.highestAverage.toFixed(2) : ''}`,
  );
  lines.push(
    `Lowest Average,${summary.lowestAverage != null ? summary.lowestAverage.toFixed(2) : ''}`,
  );
  lines.push(`Pass,${summary.passCount}`);
  lines.push(`Fail,${summary.failCount}`);
  lines.push('');

  if (summary.subjectAverages.length > 0) {
    lines.push('Subject Averages');
    lines.push('Subject,Average,Highest,Lowest');
    for (const s of summary.subjectAverages) {
      lines.push(
        [
          esc(s.subjectName),
          s.average != null ? s.average.toFixed(2) : '',
          s.highestMark != null ? s.highestMark.toFixed(1) : '',
          s.lowestMark != null ? s.lowestMark.toFixed(1) : '',
        ].join(','),
      );
    }
    lines.push('');
  }

  const subjectCols = collectSubjectCols(summary);

  if (summary.students.length > 0) {
    lines.push('Student Grades');
    const groupRow = [
      '',
      '',
      ...subjectCols.flatMap((c) =>
        hasTermExam ? [esc(c.name), '', ''] : [esc(c.name), ''],
      ),
      '',
    ];
    lines.push(groupRow.join(','));
    const cwLabel = `CW (${summary.courseworkWeight}%)`;
    const exLabel = `EX (${summary.examWeight}%)`;
    const finalLabel = isYearEnd ? 'Year' : 'Final';
    const subRow = [
      'Position',
      'Student',
      ...subjectCols.flatMap(() =>
        hasTermExam ? [cwLabel, exLabel, finalLabel] : [cwLabel, finalLabel],
      ),
      'Overall Average',
    ];
    lines.push(subRow.map(esc).join(','));

    for (const s of summary.students) {
      const subMap = new Map(s.subjects.map((sub) => [sub.subjectId, sub]));
      const row = [
        s.position != null ? String(s.position) : '',
        esc(`${s.firstName} ${s.lastName}`.trim()),
        ...subjectCols.flatMap((c) => {
          const g = subMap.get(c.id);
          const finalScore = isYearEnd
            ? (g?.yearGrade ?? null)
            : (g?.termComposite ?? null);
          if (hasTermExam) {
            return [
              num(g?.courseworkAverage ?? null),
              num(g?.examAverage ?? null),
              num(finalScore),
            ];
          }
          return [num(g?.courseworkAverage ?? null), num(finalScore)];
        }),
        s.overallAverage != null ? s.overallAverage.toFixed(2) : '',
      ];
      lines.push(row.join(','));
    }
  }

  return Buffer.from(lines.join('\n'), 'utf-8');
}

export function buildClassSummaryXlsxBuffer(
  summary: ClassSummary,
  className: string,
  reportType?: string,
  termName?: string,
  gradingModel?: string,
): Promise<Buffer> {
  const r2 = (v: number | null) =>
    v != null ? Math.round(v * 100) / 100 : null;
  const r1 = (v: number | null) => (v != null ? Math.round(v * 10) / 10 : null);
  const isYearEnd = reportType === 'year_end';
  const xlsxRules = getGradingRules(gradingModel);
  const hasTermExam = xlsxRules.termHasExam || isYearEnd;
  const colsPerSubject = hasTermExam ? 3 : 2;
  const weightLabel = isYearEnd ? 'Year' : 'Term';

  const summaryRows: (string | number | null)[][] = [
    ['Class Summary Report'],
    ['Class', className],
  ];
  if (termName) summaryRows.push(['Term', termName]);
  summaryRows.push(
    [`${weightLabel} Coursework Weight`, `${summary.courseworkWeight}%`],
    [`${weightLabel} Exam Weight`, `${summary.examWeight}%`],
    ['Total Students', summary.totalStudents],
    ['Class Average', r2(summary.classAverage)],
    ['Highest Average', r2(summary.highestAverage)],
    ['Lowest Average', r2(summary.lowestAverage)],
    ['Pass', summary.passCount],
    ['Fail', summary.failCount],
  );
  summaryRows.push(
    [],
    ['Subject Averages'],
    ['Subject', 'Average', 'Highest', 'Lowest'],
  );

  for (const s of summary.subjectAverages) {
    summaryRows.push([
      s.subjectName,
      r2(s.average),
      r1(s.highestMark),
      r1(s.lowestMark),
    ]);
  }

  const summaryColumns = [
    { width: 22 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
  ];

  const subjectCols = collectSubjectCols(summary);

  // The subject name cell spans its sub-columns; the trailing `null`s are the
  // cells covered by the span (write-excel-file's merge convention).
  const groupRow: Row = [
    '',
    '',
    ...subjectCols.flatMap((c) => {
      const cells: Cell[] = [{ value: c.name, columnSpan: colsPerSubject }];
      for (let i = 1; i < colsPerSubject; i++) cells.push(null);
      return cells;
    }),
    '',
  ];
  const cwLabel = `CW (${summary.courseworkWeight}%)`;
  const exLabel = `EX (${summary.examWeight}%)`;
  const finalLabel = isYearEnd ? 'Year' : 'Final';
  const subRow: (string | null)[] = [
    'Position',
    'Student',
    ...subjectCols.flatMap(() =>
      hasTermExam ? [cwLabel, exLabel, finalLabel] : [cwLabel, finalLabel],
    ),
    'Overall Average',
  ];
  const studentRows: SheetData = [groupRow, subRow];

  for (const s of summary.students) {
    const subMap = new Map(s.subjects.map((sub) => [sub.subjectId, sub]));
    studentRows.push([
      s.position,
      `${s.firstName} ${s.lastName}`.trim(),
      ...subjectCols.flatMap((c) => {
        const g = subMap.get(c.id);
        const finalScore = isYearEnd
          ? (g?.yearGrade ?? null)
          : (g?.termComposite ?? null);
        if (hasTermExam) {
          return [
            r1(g?.courseworkAverage ?? null),
            r1(g?.examAverage ?? null),
            r1(finalScore),
          ];
        }
        return [r1(g?.courseworkAverage ?? null), r1(finalScore)];
      }),
      r2(s.overallAverage),
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
