import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ReportDetail, ClassSummary, ReportEntryRow } from "./reports";
import type { StudentTermResult } from "./year-report";

/**
 * Build an individual student term report PDF from live calculation data.
 * `report` is optional and supplies persisted metadata (remarks, grades, status).
 */
export function buildReportPdfBlob(
  termResult: StudentTermResult,
  opts: {
    termName?: string;
    report?: ReportDetail | null;
    entryMap?: Map<string, ReportEntryRow>;
  } = {},
): Blob {
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const name = `${termResult.firstName} ${termResult.lastName}`.trim();
  const r = opts.report;
  const entryMap = opts.entryMap ?? new Map<string, ReportEntryRow>();

  doc.setFontSize(16);
  doc.text("Report card", 14, 18);
  doc.setFontSize(10);
  let y = 28;
  doc.text(`Student: ${name}`, 14, y);
  y += 6;
  if (opts.termName) {
    doc.text(`Term: ${opts.termName}`, 14, y);
    y += 6;
  }
  if (r?.report_type) {
    doc.text(`Report Type: ${r.report_type}`, 14, y);
    y += 6;
  }
  if (r?.status) {
    doc.text(`Status: ${r.status}`, 14, y);
    y += 6;
  }
  if (termResult.overallAverage != null) {
    doc.text(`Overall average: ${termResult.overallAverage.toFixed(2)}`, 14, y);
    y += 6;
  }
  if (termResult.position != null) {
    doc.text(`Position: ${termResult.position}${r?.total_students != null ? ` of ${r.total_students}` : ""}`, 14, y);
    y += 6;
  }
  if (r?.conduct) {
    doc.text(`Conduct: ${r.conduct}`, 14, y);
    y += 6;
  }
  if (r?.attendance_percentage != null) {
    doc.text(`Attendance: ${r.attendance_percentage}%`, 14, y);
    y += 6;
  }
  if (r?.class_teacher_remark) {
    const lines = doc.splitTextToSize(
      `Class teacher remark: ${r.class_teacher_remark}`,
      180,
    );
    doc.text(lines, 14, y);
    y += lines.length * 5 + 4;
  }

  autoTable(doc, {
    startY: y + 4,
    head: [["Subject", "Course", "Exam", "Term", "Grade", "Remark"]],
    body: termResult.subjects.map((s) => {
      const entry = entryMap.get(s.subjectId);
      return [
        s.subjectName,
        s.courseworkAverage != null ? s.courseworkAverage.toFixed(1) : "-",
        s.examAverage != null ? s.examAverage.toFixed(1) : "-",
        s.termComposite != null ? s.termComposite.toFixed(1) : "-",
        entry?.letter_grade ?? "-",
        (entry?.teacher_remark ?? "").slice(0, 120),
      ];
    }),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [66, 66, 66] },
  });

  return doc.output("blob");
}

/** @deprecated Use the overload that takes StudentTermResult. */
export function buildReportPdfBlobFromReport(
  r: ReportDetail,
  opts: { termName?: string } = {},
): Blob {
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const st = r.student;
  const name = st ? `${st.first_name} ${st.last_name}`.trim() : "Student";

  doc.setFontSize(16);
  doc.text("Report card", 14, 18);
  doc.setFontSize(10);
  let y = 28;
  doc.text(`Student: ${name}`, 14, y);
  y += 6;
  if (opts.termName) {
    doc.text(`Term: ${opts.termName}`, 14, y);
    y += 6;
  }
  doc.text(`Report Type: ${r.report_type ?? "-"}`, 14, y);
  y += 6;
  doc.text(`Status: ${r.status ?? "-"}`, 14, y);
  y += 6;
  if (r.overall_average != null) {
    doc.text(`Overall average: ${r.overall_average.toFixed(2)}`, 14, y);
    y += 6;
  }
  if (r.position != null && r.total_students != null) {
    doc.text(`Position: ${r.position} of ${r.total_students}`, 14, y);
    y += 6;
  }
  if (r.conduct) {
    doc.text(`Conduct: ${r.conduct}`, 14, y);
    y += 6;
  }
  if (r.attendance_percentage != null) {
    doc.text(`Attendance: ${r.attendance_percentage}%`, 14, y);
    y += 6;
  }
  if (r.class_teacher_remark) {
    const lines = doc.splitTextToSize(
      `Class teacher remark: ${r.class_teacher_remark}`,
      180,
    );
    doc.text(lines, 14, y);
    y += lines.length * 5 + 4;
  }

  autoTable(doc, {
    startY: y + 4,
    head: [
      ["Subject", "Course", "Exam", "Term", "Year", "Grade", "Remark"],
    ],
    body: r.entries.map((e) => [
      e.subject?.name ?? "-",
      e.coursework_average != null ? e.coursework_average.toFixed(1) : "-",
      e.exam_average != null ? e.exam_average.toFixed(1) : "-",
      e.term_composite != null ? e.term_composite.toFixed(1) : "-",
      e.year_grade != null ? e.year_grade.toFixed(1) : "-",
      e.letter_grade ?? "-",
      (e.teacher_remark ?? "").slice(0, 120),
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [66, 66, 66] },
  });

  return doc.output("blob");
}

/** Trigger a browser file-save dialog from an in-memory blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Build a user-friendly filename for a report PDF. */
export function pdfFilenameForReport(r: ReportDetail): string {
  const st = r.student;
  const name = st
    ? `${st.first_name}_${st.last_name}`.replace(/\s+/g, "_")
    : "report";
  return `${name}_${r.report_type ?? "report"}.pdf`;
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

export function buildClassSummaryPdfBlob(
  summary: ClassSummary,
  className: string,
  reportType?: string,
  termName?: string,
): Blob {
  const subjectCount = collectSubjectColumns(summary).length;
  const dataCols = 2 + subjectCount * 3 + 1;
  const colWidth = 11;
  const fixedWidth = 8 + 30;
  const minWidth = fixedWidth + (dataCols - 2) * colWidth + 20;
  const a4Landscape = 297;
  const pageWidth = Math.max(a4Landscape, minWidth);

  const doc = new jsPDF({
    unit: "mm",
    orientation: "landscape",
    format: [pageWidth, 210],
  });
  const fmt = (v: number | null) => (v != null ? v.toFixed(1) : "-");
  const isYearEnd = reportType === "year_end" && summary.gradingModel === "year_based";
  const weightLabel = isYearEnd ? "Year" : "Term";

  doc.setFontSize(16);
  doc.text("Class Summary Report", 14, 18);
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
      head: [["Subject", "Class Avg", "Highest", "Lowest"]],
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
      { content: "#" },
      { content: "Student" },
      ...subjectCols.flatMap((c) => [
        { content: c.name, colSpan: 3 },
        { content: "", colSpan: 0 },
        { content: "", colSpan: 0 },
      ]),
      { content: "Overall" },
    ];
    const cwLabel = `CW (${summary.courseworkWeight}%)`;
    const exLabel = `EX (${summary.examWeight}%)`;
    const finalLabel = isYearEnd ? "Year" : "Final";
    const subRow = [
      "",
      "",
      ...subjectCols.flatMap(() => [cwLabel, exLabel, finalLabel]),
      "",
    ];

    const body = summary.students.map((st) => {
      const subMap = new Map(st.subjects.map((s) => [s.subjectId, s]));
      return [
        st.position != null ? String(st.position) : "-",
        `${st.firstName} ${st.lastName}`.trim(),
        ...subjectCols.flatMap((c) => {
          const g = subMap.get(c.id);
          const finalScore = isYearEnd
            ? (g?.yearGrade ?? null)
            : (g?.termComposite ?? null);
          return [
            fmt(g?.courseworkAverage ?? null),
            fmt(g?.examAverage ?? null),
            fmt(finalScore),
          ];
        }),
        fmt(st.overallAverage),
      ];
    });

    const borderCols = new Set<number>();
    for (let i = 0; i < subjectCols.length; i++) {
      borderCols.add(2 + i * 3);
    }
    const overallCol = 2 + subjectCols.length * 3;
    borderCols.add(overallCol);

    autoTable(doc, {
      startY: y,
      head: [
        groupRow.filter((c) => c.colSpan !== 0),
        subRow,
      ],
      body,
      styles: { fontSize: 6, cellPadding: 1.5, halign: "center" },
      headStyles: { fillColor: [66, 66, 66], fontSize: 6 },
      columnStyles: {
        0: { halign: "center", cellWidth: 8 },
        1: { halign: "left", cellWidth: 30 },
      },
      didParseCell(data) {
        if (borderCols.has(data.column.index)) {
          data.cell.styles.lineWidth = { left: 0.3, top: 0, right: 0, bottom: 0 };
          data.cell.styles.lineColor = [0, 0, 0];
        }
      },
    });
  }

  return doc.output("blob");
}