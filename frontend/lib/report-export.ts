import * as XLSX from "xlsx";
import type { ClassSummary } from "./reports";

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

const num = (v: number | null) => (v != null ? v.toFixed(1) : "");

export function buildClassSummaryCsv(
  summary: ClassSummary,
  className: string,
  reportType?: string,
  termName?: string,
): Blob {
  const lines: string[] = [];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const isYearEnd = reportType === "year_end" && summary.gradingModel === "year_based";
  const weightLabel = isYearEnd ? "Year" : "Term";

  lines.push(`Class Summary Report`);
  lines.push(`Class,${esc(className)}`);
  if (termName) lines.push(`Term,${esc(termName)}`);
  lines.push(`${weightLabel} Coursework Weight,${summary.courseworkWeight}%`);
  lines.push(`${weightLabel} Exam Weight,${summary.examWeight}%`);
  lines.push(`Total Students,${summary.totalStudents}`);
  lines.push(
    `Class Average,${summary.classAverage != null ? summary.classAverage.toFixed(2) : ""}`,
  );
  lines.push(
    `Highest Average,${summary.highestAverage != null ? summary.highestAverage.toFixed(2) : ""}`,
  );
  lines.push(
    `Lowest Average,${summary.lowestAverage != null ? summary.lowestAverage.toFixed(2) : ""}`,
  );
  lines.push(`Pass,${summary.passCount}`);
  lines.push(`Fail,${summary.failCount}`);
  lines.push("");

  if (summary.subjectAverages.length > 0) {
    lines.push("Subject Averages");
    lines.push("Subject,Average,Highest,Lowest");
    for (const s of summary.subjectAverages) {
      lines.push(
        [
          esc(s.subjectName),
          s.average != null ? s.average.toFixed(2) : "",
          s.highestMark != null ? s.highestMark.toFixed(1) : "",
          s.lowestMark != null ? s.lowestMark.toFixed(1) : "",
        ].join(","),
      );
    }
    lines.push("");
  }

  const subjectCols = collectSubjectCols(summary);

  if (summary.students.length > 0) {
    lines.push("Student Grades");
    const groupRow = [
      "",
      "",
      ...subjectCols.flatMap((c) => [esc(c.name), "", ""]),
      "",
    ];
    lines.push(groupRow.join(","));
    const cwLabel = `CW (${summary.courseworkWeight}%)`;
    const exLabel = `EX (${summary.examWeight}%)`;
    const finalLabel = isYearEnd ? "Year" : "Final";
    const subRow = [
      "Position",
      "Student",
      ...subjectCols.flatMap(() => [cwLabel, exLabel, finalLabel]),
      "Overall Average",
    ];
    lines.push(subRow.map(esc).join(","));

    for (const s of summary.students) {
      const subMap = new Map(s.subjects.map((sub) => [sub.subjectId, sub]));
      const row = [
        s.position != null ? String(s.position) : "",
        esc(`${s.firstName} ${s.lastName}`.trim()),
        ...subjectCols.flatMap((c) => {
          const g = subMap.get(c.id);
          const finalScore = isYearEnd
            ? (g?.yearGrade ?? null)
            : (g?.termComposite ?? null);
          return [
            num(g?.courseworkAverage ?? null),
            num(g?.examAverage ?? null),
            num(finalScore),
          ];
        }),
        s.overallAverage != null ? s.overallAverage.toFixed(2) : "",
      ];
      lines.push(row.join(","));
    }
  }

  return new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
}

export function buildClassSummaryXlsx(
  summary: ClassSummary,
  className: string,
  reportType?: string,
  termName?: string,
): Blob {
  const wb = XLSX.utils.book_new();
  const r2 = (v: number | null) =>
    v != null ? Math.round(v * 100) / 100 : null;
  const r1 = (v: number | null) =>
    v != null ? Math.round(v * 10) / 10 : null;
  const isYearEnd = reportType === "year_end" && summary.gradingModel === "year_based";
  const weightLabel = isYearEnd ? "Year" : "Term";

  const summaryRows: (string | number | null)[][] = [
    ["Class Summary Report"],
    ["Class", className],
  ];
  if (termName) summaryRows.push(["Term", termName]);
  summaryRows.push(
    [`${weightLabel} Coursework Weight`, `${summary.courseworkWeight}%`],
    [`${weightLabel} Exam Weight`, `${summary.examWeight}%`],
    ["Total Students", summary.totalStudents],
    ["Class Average", r2(summary.classAverage)],
    ["Highest Average", r2(summary.highestAverage)],
    ["Lowest Average", r2(summary.lowestAverage)],
    ["Pass", summary.passCount],
    ["Fail", summary.failCount],
  );
  summaryRows.push([], ["Subject Averages"], ["Subject", "Average", "Highest", "Lowest"]);

  for (const s of summary.subjectAverages) {
    summaryRows.push([s.subjectName, r2(s.average), r1(s.highestMark), r1(s.lowestMark)]);
  }

  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws1["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Summary");

  const subjectCols = collectSubjectCols(summary);

  const groupRow: (string | null)[] = [
    "",
    "",
    ...subjectCols.flatMap((c) => [c.name, null, null]),
    "",
  ];
  const cwLabel = `CW (${summary.courseworkWeight}%)`;
  const exLabel = `EX (${summary.examWeight}%)`;
  const finalLabel = isYearEnd ? "Year" : "Final";
  const subRow: (string | null)[] = [
    "Position",
    "Student",
    ...subjectCols.flatMap(() => [cwLabel, exLabel, finalLabel]),
    "Overall Average",
  ];
  const studentRows: (string | number | null)[][] = [groupRow, subRow];

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
        return [
          r1(g?.courseworkAverage ?? null),
          r1(g?.examAverage ?? null),
          r1(finalScore),
        ];
      }),
      r2(s.overallAverage),
    ]);
  }

  const ws2 = XLSX.utils.aoa_to_sheet(studentRows);

  const merges: XLSX.Range[] = [];
  for (let i = 0; i < subjectCols.length; i++) {
    const startCol = 2 + i * 3;
    merges.push({ s: { r: 0, c: startCol }, e: { r: 0, c: startCol + 2 } });
  }
  ws2["!merges"] = merges;

  const colWidths: { wch: number }[] = [
    { wch: 10 },
    { wch: 28 },
    ...subjectCols.flatMap(() => [{ wch: 12 }, { wch: 12 }, { wch: 12 }]),
    { wch: 16 },
  ];
  ws2["!cols"] = colWidths;
  XLSX.utils.book_append_sheet(wb, ws2, "Students");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
