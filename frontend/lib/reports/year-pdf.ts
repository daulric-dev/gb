import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { StudentYearReport, YearEndSubjectResult } from "./calculations";
import { getGradingRules } from "@/lib/grading-rules";

function fmt(v: number | null): string {
  return v != null ? v.toFixed(1) : "-";
}

function termInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

function computeLetterGrade(score: number | null): string {
  if (score == null) return "-";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  if (score >= 40) return "E";
  return "F";
}

export function buildYearReportPdfBlob(
  yr: StudentYearReport,
  opts: {
    className?: string;
    academicYearName?: string;
    yearCwWeight?: number;
    yearExWeight?: number;
  } = {},
): Blob {
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const name = `${yr.firstName} ${yr.lastName}`.trim();

  doc.setFontSize(16);
  doc.text("YEAR-END REPORT CARD", 105, 18, { align: "center" });

  doc.setFontSize(10);
  let y = 30;

  if (opts.academicYearName) {
    doc.text(`Academic Year: ${opts.academicYearName}`, 14, y);
    y += 6;
  }
  doc.text(`Student: ${name}`, 14, y);
  if (opts.className) {
    doc.text(`Class: ${opts.className}`, 120, y);
  }
  y += 6;

  if (yr.position != null) {
    doc.text(`Position: ${yr.position}`, 14, y);
    y += 6;
  }

  if (yr.yearEnd.overallAverage != null) {
    doc.text(
      `Overall Year Average: ${yr.yearEnd.overallAverage.toFixed(2)}`,
      14,
      y,
    );
    y += 6;
  }

  if (opts.yearCwWeight != null && opts.yearExWeight != null) {
    doc.text(
      `Year Weights - Coursework: ${opts.yearCwWeight}%  |  Exam: ${opts.yearExWeight}%`,
      14,
      y,
    );
    y += 6;
  }
  y += 4;

  const termNames = yr.terms.map((t) => t.termName);
  const termInitials = termNames.map(termInitial);
  const termIds = yr.terms.map((t) => t.termId);
  const lastTermId = termIds.length > 0 ? termIds[termIds.length - 1] : null;

  const lastTermSubjects = lastTermId
    ? yr.terms.find((t) => t.termId === lastTermId)?.subjects ?? []
    : [];
  const lastTermExamMap = new Map<string, number | null>();
  for (const s of lastTermSubjects) {
    lastTermExamMap.set(s.subjectId, s.examAverage);
  }

  const rules = getGradingRules(yr.gradingModel);
  const cwW = yr.yearCourseworkWeight ?? opts.yearCwWeight ?? 40;
  const exW = yr.yearExamWeight ?? opts.yearExWeight ?? 60;
  const isPooled = rules.display.yearEndColumns === "pooled";

  let head: string[];
  let body: string[][];

  if (isPooled) {
    head = ["Subject", `CA /${cwW}`, `Exam /${exW}`, "Total", "Grade"];

    body = yr.yearEnd.subjects.map((sub: YearEndSubjectResult) => {
      const composites = sub.termGrades
        .map((g) => g.termComposite)
        .filter((v): v is number => v != null);
      const rawCa = composites.length > 0
        ? composites.reduce((a, b) => a + b, 0) / composites.length
        : null;
      const ca = rawCa != null ? (rawCa * cwW / 100).toFixed(1) : "-";

      const endOfYrExam = lastTermExamMap.get(sub.subjectId) ?? null;
      const exam = endOfYrExam != null ? (endOfYrExam * exW / 100).toFixed(1) : "-";

      return [
        sub.subjectName,
        ca,
        exam,
        fmt(sub.yearGrade),
        computeLetterGrade(sub.yearGrade),
      ];
    });

    if (yr.yearEnd.overallAverage != null) {
      body.push([
        "OVERALL",
        "",
        "",
        yr.yearEnd.overallAverage.toFixed(1),
        computeLetterGrade(yr.yearEnd.overallAverage),
      ]);
    }
  } else {
    head = [
      "Subject",
      ...termInitials,
      "End of Yr Exam",
      "Year Grade",
      "Grade",
    ];

    body = yr.yearEnd.subjects.map((sub: YearEndSubjectResult) => {
      const termScores = yr.terms.map((t) => {
        const tg = sub.termGrades.find((g) => g.termId === t.termId);
        return fmt(tg?.termComposite ?? null);
      });

      const endOfYrExam = lastTermExamMap.get(sub.subjectId) ?? null;

      return [
        sub.subjectName,
        ...termScores,
        fmt(endOfYrExam),
        fmt(sub.yearGrade),
        computeLetterGrade(sub.yearGrade),
      ];
    });

    if (yr.yearEnd.overallAverage != null) {
      body.push([
        "OVERALL",
        ...yr.terms.map((t) =>
          t.overallAverage != null ? t.overallAverage.toFixed(1) : "-",
        ),
        "",
        yr.yearEnd.overallAverage.toFixed(1),
        computeLetterGrade(yr.yearEnd.overallAverage),
      ]);
    }
  }

  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [66, 66, 66] },
    columnStyles: {
      0: { halign: "left", cellWidth: 35 },
    },
    didParseCell(data) {
      if (
        data.section === "body" &&
        data.row.index === body.length - 1
      ) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [235, 235, 235];
      }
    },
  });

  const tableY =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY + 8;

  doc.setFontSize(8);
  if (isPooled) {
    doc.text(
      `CA = Coursework Average (${cwW}%)  |  Exam = Final Exam (${exW}%)  |  Total = Weighted year calculation`,
      14,
      tableY,
    );
  } else {
    const legend = termInitials
      .map((ini, i) => `${ini} = ${termNames[i]}`)
      .join("  |  ");
    doc.text(
      `${legend}  |  End of Yr Exam = Exam from final term  |  Year Grade = Weighted year calculation`,
      14,
      tableY,
    );
  }

  return doc.output("blob");
}

export function yearReportPdfFilename(yr: StudentYearReport): string {
  const name = `${yr.firstName}_${yr.lastName}`.replace(/\s+/g, "_");
  return `${name}_year_report.pdf`;
}

export function buildYearClassSummaryPdfBlob(
  students: StudentYearReport[],
  className: string,
  opts: {
    academicYearName?: string;
    yearCwWeight?: number;
    yearExWeight?: number;
  } = {},
): Blob {
  const subjectSet = new Map<string, string>();
  for (const st of students) {
    for (const sub of st.yearEnd.subjects) {
      if (!subjectSet.has(sub.subjectId)) {
        subjectSet.set(sub.subjectId, sub.subjectName);
      }
    }
  }
  const subjectCols = [...subjectSet.entries()].map(([id, name]) => ({
    id,
    name,
  }));

  const summaryRules = getGradingRules(students[0]?.gradingModel);
  const isPooledSummary = summaryRules.display.yearEndColumns === "pooled";
  const termCount = students[0]?.terms.length ?? 0;
  const colsPerSubject = isPooledSummary ? 3 : (termCount + 2);
  const dataCols = 2 + subjectCols.length * colsPerSubject + 1;
  const colWidth = 10;
  const fixedWidth = 6 + 26;
  const minWidth = fixedWidth + (dataCols - 2) * colWidth + 20;
  const a4Landscape = 297;
  const pageWidth = Math.max(a4Landscape, minWidth);

  const doc = new jsPDF({
    unit: "mm",
    orientation: "landscape",
    format: [pageWidth, 210],
  });

  doc.setFontSize(16);
  doc.text("Year-End Class Summary Report", 14, 18);
  doc.setFontSize(10);
  let y = 28;
  doc.text(`Class: ${className}`, 14, y);
  y += 6;
  if (opts.academicYearName) {
    doc.text(`Academic Year: ${opts.academicYearName}`, 14, y);
    y += 6;
  }
  if (opts.yearCwWeight != null && opts.yearExWeight != null) {
    doc.text(
      `Year Weights -Coursework: ${opts.yearCwWeight}%  |  Exam: ${opts.yearExWeight}%`,
      14,
      y,
    );
    y += 6;
  }
  doc.text(`Total students: ${students.length}`, 14, y);
  y += 6;

  const overalls = students
    .map((s) => s.yearEnd.overallAverage)
    .filter((a): a is number => a != null);
  if (overalls.length > 0) {
    const avg = overalls.reduce((s, v) => s + v, 0) / overalls.length;
    doc.text(`Class average: ${avg.toFixed(2)}`, 14, y);
    y += 6;
  }
  y += 4;

  if (students.length === 0 || subjectCols.length === 0) {
    doc.text("No data available.", 14, y);
    return doc.output("blob");
  }

  const termNames =
    students[0]?.terms.map((t) => t.termName) ?? [];
  const termInitials = termNames.map(termInitial);
  const termIds =
    students[0]?.terms.map((t) => t.termId) ?? [];

  const lastTermId = termIds.length > 0 ? termIds[termIds.length - 1] : null;

  const cwWSummary = students[0]?.yearCourseworkWeight ?? opts.yearCwWeight ?? 40;
  const exWSummary = students[0]?.yearExamWeight ?? opts.yearExWeight ?? 60;

  let subHeadersSummary: string[];
  if (isPooledSummary) {
    subHeadersSummary = [`CA /${cwWSummary}`, `Ex /${exWSummary}`, "Total"];
  } else {
    subHeadersSummary = [...termInitials, "E", "Year"];
  }

  const groupRow: { content: string; colSpan?: number }[] = [
    { content: "#" },
    { content: "Student" },
    ...subjectCols.flatMap((c) => [
      { content: c.name, colSpan: colsPerSubject },
      ...Array.from({ length: colsPerSubject - 1 }, () => ({
        content: "",
        colSpan: 0,
      })),
    ]),
    { content: "Year Avg" },
  ];

  const subRow = [
    "",
    "",
    ...subjectCols.flatMap(() => subHeadersSummary),
    "",
  ];

  const bodyRows = students.map((st) => {
    const subMap = new Map(
      st.yearEnd.subjects.map((s) => [s.subjectId, s]),
    );
    const lastTerm = lastTermId
      ? st.terms.find((t) => t.termId === lastTermId)
      : undefined;
    const lastTermExamMapLocal = new Map<string, number | null>();
    if (lastTerm) {
      for (const s of lastTerm.subjects) {
        lastTermExamMapLocal.set(s.subjectId, s.examAverage);
      }
    }

    return [
      st.position != null ? String(st.position) : "-",
      `${st.firstName} ${st.lastName}`.trim(),
      ...subjectCols.flatMap((c) => {
        const sub = subMap.get(c.id);

        if (isPooledSummary) {
          const composites = (sub?.termGrades ?? [])
            .map((g) => g.termComposite)
            .filter((v): v is number => v != null);
          const rawCa = composites.length > 0
            ? composites.reduce((a, b) => a + b, 0) / composites.length
            : null;
          const ca = rawCa != null ? (rawCa * cwWSummary / 100).toFixed(1) : "-";
          const endOfYrExam = lastTermExamMapLocal.get(c.id) ?? null;
          const exam = endOfYrExam != null ? (endOfYrExam * exWSummary / 100).toFixed(1) : "-";
          return [ca, exam, fmt(sub?.yearGrade ?? null)];
        }

        const termScores = termIds.map((tid) => {
          const tg = sub?.termGrades.find((g) => g.termId === tid);
          return fmt(tg?.termComposite ?? null);
        });
        const endOfYrExam = lastTermExamMapLocal.get(c.id) ?? null;
        return [...termScores, fmt(endOfYrExam), fmt(sub?.yearGrade ?? null)];
      }),
      fmt(st.yearEnd.overallAverage),
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
    body: bodyRows,
    styles: { fontSize: 5, cellPadding: 1, halign: "center" },
    headStyles: { fillColor: [66, 66, 66], fontSize: 5 },
    columnStyles: {
      0: { halign: "center", cellWidth: 6 },
      1: { halign: "left", cellWidth: 26 },
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

  return doc.output("blob");
}
