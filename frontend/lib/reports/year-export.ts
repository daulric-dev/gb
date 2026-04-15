import * as XLSX from "xlsx";
import type { StudentYearReport } from "./calculations";

function fmt(v: number | null): string {
  return v != null ? v.toFixed(1) : "";
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

export function buildYearClassSummaryCsv(
  students: StudentYearReport[],
  className: string,
  opts: {
    academicYearName?: string;
    yearCwWeight?: number;
    yearExWeight?: number;
  } = {},
): Blob {
  const lines: string[] = [];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;

  lines.push("Year-End Class Summary Report");
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
  lines.push("");

  const subjectCols = collectSubjectCols(students);
  const termNames = students[0]?.terms.map((t) => t.termName) ?? [];
  const termInitials = termNames.map(termInitial);
  const termIds = students[0]?.terms.map((t) => t.termId) ?? [];

  const lastTermId = termIds.length > 0 ? termIds[termIds.length - 1] : null;

  if (students.length > 0 && subjectCols.length > 0) {
    lines.push("Student Year Grades");

    const groupRow = [
      "",
      "",
      ...subjectCols.flatMap((c) => [
        esc(c.name),
        ...Array.from({ length: termInitials.length + 1 }, () => ""),
      ]),
      "",
    ];
    lines.push(groupRow.join(","));

    const subRow = [
      "Position",
      "Student",
      ...subjectCols.flatMap(() => [...termInitials, "E", "Year"]),
      "Year Average",
    ];
    lines.push(subRow.map(esc).join(","));

    for (const st of students) {
      const subMap = new Map(
        st.yearEnd.subjects.map((s) => [s.subjectId, s]),
      );
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
        st.position != null ? String(st.position) : "",
        esc(`${st.firstName} ${st.lastName}`.trim()),
        ...subjectCols.flatMap((c) => {
          const sub = subMap.get(c.id);
          const termScores = termIds.map((tid) => {
            const tg = sub?.termGrades.find((g) => g.termId === tid);
            return fmt(tg?.termComposite ?? null);
          });
          const endOfYrExam = lastTermExamMap.get(c.id) ?? null;
          return [...termScores, fmt(endOfYrExam), fmt(sub?.yearGrade ?? null)];
        }),
        st.yearEnd.overallAverage != null
          ? st.yearEnd.overallAverage.toFixed(2)
          : "",
      ];
      lines.push(row.join(","));
    }
  }

  return new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
}

export function buildYearClassSummaryXlsx(
  students: StudentYearReport[],
  className: string,
  opts: {
    academicYearName?: string;
    yearCwWeight?: number;
    yearExWeight?: number;
  } = {},
): Blob {
  const wb = XLSX.utils.book_new();

  const summaryRows: (string | number | null)[][] = [
    ["Year-End Class Summary Report"],
    ["Class", className],
  ];
  if (opts.academicYearName)
    summaryRows.push(["Academic Year", opts.academicYearName]);
  if (opts.yearCwWeight != null)
    summaryRows.push(["Year Coursework Weight", `${opts.yearCwWeight}%`]);
  if (opts.yearExWeight != null)
    summaryRows.push(["Year Exam Weight", `${opts.yearExWeight}%`]);
  summaryRows.push(["Total Students", students.length]);

  const overalls = students
    .map((s) => s.yearEnd.overallAverage)
    .filter((a): a is number => a != null);
  if (overalls.length > 0) {
    const avg = overalls.reduce((s, v) => s + v, 0) / overalls.length;
    summaryRows.push(["Class Average", r2(avg)]);
  }

  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws1["!cols"] = [{ wch: 24 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Summary");

  const subjectCols = collectSubjectCols(students);
  const termNames = students[0]?.terms.map((t) => t.termName) ?? [];
  const termInitials = termNames.map(termInitial);
  const termIds = students[0]?.terms.map((t) => t.termId) ?? [];

  const lastTermId = termIds.length > 0 ? termIds[termIds.length - 1] : null;
  const colsPerSubject = termInitials.length + 2;

  const groupRow: (string | null)[] = [
    "",
    "",
    ...subjectCols.flatMap((c) => [
      c.name,
      ...Array.from({ length: colsPerSubject - 1 }, () => null),
    ]),
    "",
  ];
  const subRow: (string | null)[] = [
    "Position",
    "Student",
    ...subjectCols.flatMap(() => [...termInitials, "E", "Year"]),
    "Year Average",
  ];
  const studentRows: (string | number | null)[][] = [groupRow, subRow];

  for (const st of students) {
    const subMap = new Map(
      st.yearEnd.subjects.map((s) => [s.subjectId, s]),
    );
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

  const ws2 = XLSX.utils.aoa_to_sheet(studentRows);

  const merges: XLSX.Range[] = [];
  for (let i = 0; i < subjectCols.length; i++) {
    const startCol = 2 + i * colsPerSubject;
    merges.push({
      s: { r: 0, c: startCol },
      e: { r: 0, c: startCol + colsPerSubject - 1 },
    });
  }
  ws2["!merges"] = merges;

  const colWidths: { wch: number }[] = [
    { wch: 10 },
    { wch: 28 },
    ...subjectCols.flatMap(() =>
      Array.from({ length: colsPerSubject }, () => ({ wch: 12 })),
    ),
    { wch: 16 },
  ];
  ws2["!cols"] = colWidths;
  XLSX.utils.book_append_sheet(wb, ws2, "Students");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
