import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ClassSummary } from './class-summary.transform';
import type { StudentTermResult } from '@/calculation/interfaces/calculation.interfaces';
import { getGradingRules } from './grading-rules';

export function buildReportPdfBuffer(
  termResult: StudentTermResult,
  opts: { termName?: string; gradingModel?: string } = {},
): Buffer {
  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  const name = `${termResult.firstName} ${termResult.lastName}`.trim();
  const rules = getGradingRules(opts.gradingModel);
  const hasTermExam = rules.termHasExam;

  doc.setFontSize(16);
  doc.text('Report card', 14, 18);
  doc.setFontSize(10);
  let y = 28;
  doc.text(`Student: ${name}`, 14, y);
  y += 6;
  if (opts.termName) {
    doc.text(`Term: ${opts.termName}`, 14, y);
    y += 6;
  }
  if (termResult.overallAverage != null) {
    doc.text(`Overall average: ${termResult.overallAverage.toFixed(2)}`, 14, y);
    y += 6;
  }
  if (termResult.position != null) {
    doc.text(`Position: ${termResult.position}`, 14, y);
    y += 6;
  }

  const head = hasTermExam
    ? [['Subject', 'Coursework', 'Exam', 'Term']]
    : [['Subject', 'Coursework', 'Term']];

  const body = termResult.subjects.map((s) => {
    const row = [
      s.subjectName,
      s.courseworkAverage != null ? s.courseworkAverage.toFixed(1) : '-',
    ];
    if (hasTermExam) {
      row.push(s.examAverage != null ? s.examAverage.toFixed(1) : '-');
    }
    row.push(s.termComposite != null ? s.termComposite.toFixed(1) : '-');
    return row;
  });

  autoTable(doc, {
    startY: y + 4,
    head,
    body,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [66, 66, 66] },
  });

  return Buffer.from(doc.output('arraybuffer'));
}

function collectSubjectColumns(summary: ClassSummary) {
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

export function buildClassSummaryPdfBuffer(
  summary: ClassSummary,
  className: string,
  reportType?: string,
  termName?: string,
  gradingModel?: string,
): Buffer {
  const classRules = getGradingRules(gradingModel);
  const hasTermExam = classRules.termHasExam || reportType === 'year_end';
  const colsPerSubject = hasTermExam ? 3 : 2;
  const subjectCount = collectSubjectColumns(summary).length;
  const dataCols = 2 + subjectCount * colsPerSubject + 1;
  const colWidth = 11;
  const fixedWidth = 8 + 30;
  const minWidth = fixedWidth + (dataCols - 2) * colWidth + 20;
  const a4Landscape = 297;
  const pageWidth = Math.max(a4Landscape, minWidth);

  const doc = new jsPDF({
    unit: 'mm',
    orientation: 'landscape',
    format: [pageWidth, 210],
  });
  const fmt = (v: number | null) => (v != null ? v.toFixed(1) : '-');
  const isYearEnd = reportType === 'year_end';
  const weightLabel = isYearEnd ? 'Year' : 'Term';

  doc.setFontSize(16);
  doc.text('Class Summary Report', 14, 18);
  doc.setFontSize(10);
  let y = 28;
  doc.text(`Class: ${className}`, 14, y);
  y += 6;
  if (termName) {
    doc.text(`Term: ${termName}`, 14, y);
    y += 6;
  }
  doc.text(
    `${weightLabel} Weights - Coursework: ${summary.courseworkWeight}%  |  Exam: ${summary.examWeight}%`,
    14,
    y,
  );
  y += 6;
  doc.text(`Total students: ${summary.totalStudents}`, 14, y);
  y += 6;
  if (summary.classAverage != null) {
    doc.text(`Class average: ${summary.classAverage.toFixed(2)}`, 14, y);
    y += 6;
  }
  if (summary.highestAverage != null && summary.lowestAverage != null) {
    doc.text(
      `Highest: ${summary.highestAverage.toFixed(1)}  |  Lowest: ${summary.lowestAverage.toFixed(1)}`,
      14,
      y,
    );
    y += 6;
  }
  doc.text(`Pass: ${summary.passCount}  |  Fail: ${summary.failCount}`, 14, y);
  y += 8;

  if (summary.subjectAverages.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Subject', 'Class Avg', 'Highest', 'Lowest']],
      body: summary.subjectAverages.map((s) => [
        s.subjectName,
        fmt(s.average),
        fmt(s.highestMark),
        fmt(s.lowestMark),
      ]),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [66, 66, 66] },
    });
    y =
      (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
        .finalY + 6;
  }

  const subjectCols = collectSubjectColumns(summary);

  if (summary.students.length > 0 && subjectCols.length > 0) {
    const groupRow: { content: string; colSpan?: number }[] = [
      { content: '#' },
      { content: 'Student' },
      ...subjectCols.flatMap((c) => {
        const cells: { content: string; colSpan?: number }[] = [
          { content: c.name, colSpan: colsPerSubject },
        ];
        for (let i = 1; i < colsPerSubject; i++) {
          cells.push({ content: '', colSpan: 0 });
        }
        return cells;
      }),
      { content: 'Overall' },
    ];
    const cwLabel = `CW (${summary.courseworkWeight}%)`;
    const exLabel = `EX (${summary.examWeight}%)`;
    const finalLabel = isYearEnd ? 'Year' : 'Final';
    const subRow = [
      '',
      '',
      ...subjectCols.flatMap(() =>
        hasTermExam ? [cwLabel, exLabel, finalLabel] : [cwLabel, finalLabel],
      ),
      '',
    ];

    const body = summary.students.map((st) => {
      const subMap = new Map(st.subjects.map((s) => [s.subjectId, s]));
      return [
        st.position != null ? String(st.position) : '-',
        `${st.firstName} ${st.lastName}`.trim(),
        ...subjectCols.flatMap((c) => {
          const g = subMap.get(c.id);
          const finalScore = isYearEnd
            ? (g?.yearGrade ?? null)
            : (g?.termComposite ?? null);
          if (hasTermExam) {
            return [
              fmt(g?.courseworkAverage ?? null),
              fmt(g?.examAverage ?? null),
              fmt(finalScore),
            ];
          }
          return [fmt(g?.courseworkAverage ?? null), fmt(finalScore)];
        }),
        fmt(st.overallAverage),
      ];
    });

    const borderCols = new Set<number>();
    for (let i = 0; i < subjectCols.length; i++) {
      borderCols.add(2 + i * colsPerSubject);
    }
    const overallCol = 2 + subjectCols.length * colsPerSubject;
    borderCols.add(overallCol);

    autoTable(doc, {
      startY: y,
      head: [groupRow.filter((c) => c.colSpan !== 0), subRow],
      body,
      styles: { fontSize: 6, cellPadding: 1.5, halign: 'center' },
      headStyles: { fillColor: [66, 66, 66], fontSize: 6 },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },
        1: { halign: 'left', cellWidth: 30 },
      },
      didParseCell(data) {
        if (borderCols.has(data.column.index)) {
          data.cell.styles.lineWidth = {
            left: 0.3,
            top: 0,
            right: 0,
            bottom: 0,
          };
          data.cell.styles.lineColor = [0, 0, 0];
        }
      },
    });
  }

  return Buffer.from(doc.output('arraybuffer'));
}
