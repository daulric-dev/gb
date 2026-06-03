import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type {
  ClassSummary,
  StudentSubjectGrade,
} from "./class-summary.transform";
import { getGradingRules } from "./grading-rules";

export interface ExamYearRow {
  studentId: string;
  firstName: string;
  lastName: string;
  yearCourseworkWeight?: number;
  yearExamWeight?: number;
  terms: {
    termId: string;
    termName: string;
    subjects: { subjectId: string; termComposite: number | null; examAverage?: number | null }[];
  }[];
  yearEnd: {
    subjects: {
      subjectId: string;
      subjectName: string;
      yearGrade: number | null;
      termGrades: { termId: string; termName: string; termComposite: number | null }[];
    }[];
    overallAverage: number | null;
  };
  position?: number;
}

export interface ExamReportOptions {
  title?: string;
  className?: string;
  termName?: string;
  academicYear?: string;
  scoreField?: keyof Pick<
    StudentSubjectGrade,
    "termComposite" | "yearGrade" | "examAverage"
  >;
  yearResults?: ExamYearRow[];
  gradingModel?: string;
}

function collectSubjects(summary: ClassSummary) {
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

function fmt(v: number | null): string {
  return v != null ? v.toFixed(1) : "-";
}

const BORDER = "#000";
const BW = 0.5;

const NAME_COL = 130;
const SUMMARY_COL = 38;
const HEADER_HEIGHT = 90;
const ROW_HEIGHT = 18;

const base = StyleSheet.create({
  page: { padding: 30, fontFamily: "Helvetica" },
  title: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 4,
    fontFamily: "Helvetica-Bold",
  },
  subtitle: {
    fontSize: 10,
    textAlign: "center",
    marginBottom: 2,
    fontFamily: "Helvetica-Bold",
  },
  meta: {
    fontSize: 9,
    textAlign: "center",
    marginBottom: 12,
    color: "#333",
  },
  table: {
    borderTopWidth: BW,
    borderLeftWidth: BW,
    borderColor: BORDER,
  },
  headerRow: {
    flexDirection: "row",
    height: HEADER_HEIGHT,
    borderBottomWidth: BW,
    borderColor: BORDER,
  },
  dataRow: {
    flexDirection: "row",
    minHeight: ROW_HEIGHT,
    borderBottomWidth: BW,
    borderColor: BORDER,
  },

  nameHeaderCell: {
    width: NAME_COL,
    borderRightWidth: BW,
    borderColor: BORDER,
    justifyContent: "flex-end",
    paddingBottom: 6,
    paddingLeft: 8,
  },
  verticalHeaderCell: {
    borderRightWidth: BW,
    borderColor: BORDER,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  verticalText: {
    fontSize: 7,
    transform: "rotate(-90deg)",
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
  },

  nameCell: {
    width: NAME_COL,
    borderRightWidth: BW,
    borderColor: BORDER,
    justifyContent: "center",
    paddingLeft: 8,
  },
  dataCell: {
    borderRightWidth: BW,
    borderColor: BORDER,
    justifyContent: "center",
    alignItems: "center",
  },

  nameHeaderText: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  nameText: { fontSize: 8 },
  cellText: { fontSize: 7 },
  boldCell: { fontSize: 7, fontFamily: "Helvetica-Bold" },
});

export function EndOfYearExamDocument({
  summary,
  options = {},
}: {
  summary: ClassSummary;
  options?: ExamReportOptions;
}) {
  const subjects = collectSubjects(summary);
  const field = options.scoreField ?? "termComposite";
  const rules = getGradingRules(options.gradingModel);
  const isPooled = rules.display.yearEndColumns === "pooled" && !!options.yearResults?.length;

  const usable = 842 - 60;
  const fixedWidth = NAME_COL + SUMMARY_COL * 3;

  const metaParts = [
    options.className && `Class: ${options.className}`,
    options.academicYear && `Academic Year: ${options.academicYear}`,
    options.termName && `Term: ${options.termName}`,
  ].filter(Boolean);

  if (isPooled) {
    const yearResults = options.yearResults!;
    const cwW = yearResults[0]?.yearCourseworkWeight ?? 40;
    const exW = yearResults[0]?.yearExamWeight ?? 60;

    const yrSubjects: { id: string; name: string }[] = [];
    const seenYr = new Set<string>();
    for (const yr of yearResults) {
      for (const s of yr.yearEnd.subjects) {
        if (!seenYr.has(s.subjectId)) {
          seenYr.add(s.subjectId);
          yrSubjects.push({ id: s.subjectId, name: s.subjectName });
        }
      }
    }

    const showFinal = rules.display.examColumnLocation === "final_term_only";
    const colsPerSubject = 1 + (showFinal ? 1 : 0) + 1;
    const totalSubCols = yrSubjects.length * colsPerSubject + 3;
    const subColWidth = Math.min(
      38,
      Math.max(22, (usable - NAME_COL) / Math.max(totalSubCols, 1)),
    );

    const lastTermId = yearResults[0]?.terms[yearResults[0].terms.length - 1]?.termId ?? null;

    const sorted = [...yearResults].sort(
      (a, b) => (a.position ?? 999) - (b.position ?? 999),
    );

    const SUBHEADER_HEIGHT = 22;
    const TOPHEADER_HEIGHT = 20;

    return (
      <Document>
        <Page size="A4" orientation="landscape" style={base.page}>
          <Text style={base.title}>
            {options.title ?? "END OF YEAR EXAMINATIONS"}
          </Text>
          <Text style={base.subtitle}>
            {`CA (${cwW}%) + Exam (${exW}%) = Total`}
          </Text>

          {metaParts.length > 0 && (
            <Text style={base.meta}>{metaParts.join("   |   ")}</Text>
          )}

          <View style={base.table}>
            {/* Top header row: subject names spanning sub-columns */}
            <View style={{ flexDirection: "row", borderBottomWidth: BW, borderColor: BORDER, minHeight: TOPHEADER_HEIGHT }}>
              <View style={{ width: NAME_COL, borderRightWidth: BW, borderColor: BORDER }} />
              {yrSubjects.map((s) => (
                <View
                  key={s.id}
                  style={{
                    width: subColWidth * colsPerSubject,
                    borderRightWidth: BW,
                    borderColor: BORDER,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", textAlign: "center" }}>
                    {s.name}
                  </Text>
                </View>
              ))}
              <View style={{ width: subColWidth, borderRightWidth: BW, borderColor: BORDER }} />
              <View style={{ width: subColWidth, borderRightWidth: BW, borderColor: BORDER }} />
              <View style={{ width: subColWidth, borderRightWidth: BW, borderColor: BORDER }} />
            </View>

            {/* Sub-header row: AVG, FINAL, Total under each subject */}
            <View style={{ flexDirection: "row", borderBottomWidth: BW, borderColor: BORDER, minHeight: SUBHEADER_HEIGHT }}>
              <View style={{ width: NAME_COL, borderRightWidth: BW, borderColor: BORDER, justifyContent: "center", paddingLeft: 8 }}>
                <Text style={base.nameHeaderText}>Student&apos;s Name</Text>
              </View>

              {yrSubjects.flatMap((s) => [
                <View key={`${s.id}-avg`} style={{ width: subColWidth, borderRightWidth: BW, borderColor: BORDER, justifyContent: "center", alignItems: "center" }}>
                  <Text style={{ fontSize: 6, fontFamily: "Helvetica-Bold", textAlign: "center" }}>{`AVG /${cwW}`}</Text>
                </View>,
                ...(showFinal ? [
                  <View key={`${s.id}-final`} style={{ width: subColWidth, borderRightWidth: BW, borderColor: BORDER, justifyContent: "center", alignItems: "center" }}>
                    <Text style={{ fontSize: 6, fontFamily: "Helvetica-Bold", textAlign: "center" }}>{`FINAL /${exW}`}</Text>
                  </View>,
                ] : []),
                <View key={`${s.id}-total`} style={{ width: subColWidth, borderRightWidth: BW, borderColor: BORDER, justifyContent: "center", alignItems: "center" }}>
                  <Text style={{ fontSize: 6, fontFamily: "Helvetica-Bold", textAlign: "center" }}>Total</Text>
                </View>,
              ])}

              <View style={{ width: subColWidth, borderRightWidth: BW, borderColor: BORDER, justifyContent: "center", alignItems: "center" }}>
                <Text style={{ fontSize: 6, fontFamily: "Helvetica-Bold", textAlign: "center" }}>TOTAL</Text>
              </View>
              <View style={{ width: subColWidth, borderRightWidth: BW, borderColor: BORDER, justifyContent: "center", alignItems: "center" }}>
                <Text style={{ fontSize: 6, fontFamily: "Helvetica-Bold", textAlign: "center" }}>AVE.</Text>
              </View>
              <View style={{ width: subColWidth, borderRightWidth: BW, borderColor: BORDER, justifyContent: "center", alignItems: "center" }}>
                <Text style={{ fontSize: 6, fontFamily: "Helvetica-Bold", textAlign: "center" }}>Position</Text>
              </View>
            </View>

            {/* Data rows */}
            {sorted.map((yr) => {
              const subMap = new Map(
                yr.yearEnd.subjects.map((s) => [s.subjectId, s]),
              );
              const lastTerm = lastTermId
                ? yr.terms.find((t) => t.termId === lastTermId)
                : undefined;

              const yearGrades: number[] = [];

              const cells = yrSubjects.flatMap((col) => {
                const sub = subMap.get(col.id);
                const result: { key: string; value: number | null; bold?: boolean }[] = [];

                const composites = (sub?.termGrades ?? [])
                  .map((g) => g.termComposite)
                  .filter((v): v is number => v != null);
                const rawAvg = composites.length > 0
                  ? composites.reduce((a, b) => a + b, 0) / composites.length
                  : null;
                const scaledAvg = rawAvg != null ? rawAvg * cwW / 100 : null;
                result.push({ key: `${yr.studentId}-${col.id}-avg`, value: scaledAvg });

                if (showFinal) {
                  const lastTermSubj = lastTerm?.subjects.find(
                    (s) => s.subjectId === col.id,
                  );
                  const rawExam = lastTermSubj?.examAverage ?? null;
                  const exam = rules.display.examScaledToYearWeight && rawExam != null
                    ? rawExam * exW / 100
                    : rawExam;
                  result.push({ key: `${yr.studentId}-${col.id}-final`, value: exam });
                }

                const total = sub?.yearGrade ?? null;
                if (total != null) yearGrades.push(total);
                result.push({ key: `${yr.studentId}-${col.id}-yr`, value: total, bold: true });

                return result;
              });

              const grandTotal = yearGrades.reduce((s, v) => s + v, 0);

              return (
                <View key={yr.studentId} style={base.dataRow}>
                  <View style={base.nameCell}>
                    <Text style={base.nameText}>
                      {`${yr.firstName} ${yr.lastName}`.trim()}
                    </Text>
                  </View>

                  {cells.map((cell) => (
                    <View key={cell.key} style={[base.dataCell, { width: subColWidth }]}>
                      <Text style={cell.bold ? base.boldCell : base.cellText}>
                        {fmt(cell.value)}
                      </Text>
                    </View>
                  ))}

                  <View style={[base.dataCell, { width: subColWidth }]}>
                    <Text style={base.boldCell}>
                      {yearGrades.length > 0 ? grandTotal.toFixed(1) : "-"}
                    </Text>
                  </View>
                  <View style={[base.dataCell, { width: subColWidth }]}>
                    <Text style={base.boldCell}>
                      {fmt(yr.yearEnd.overallAverage)}
                    </Text>
                  </View>
                  <View style={[base.dataCell, { width: subColWidth }]}>
                    <Text style={base.boldCell}>
                      {yr.position != null ? String(yr.position) : "-"}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </Page>
      </Document>
    );
  }

  const subColWidth = Math.min(
    38,
    Math.max(22, (usable - fixedWidth) / Math.max(subjects.length, 1)),
  );

  const sorted = [...summary.students].sort(
    (a, b) => (a.position ?? 999) - (b.position ?? 999),
  );

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={base.page}>
        <Text style={base.title}>
          {options.title ?? "END OF YEAR EXAMINATIONS"}
        </Text>
        <Text style={base.subtitle}>SUBJECTS : Marks out of 100%</Text>

        {metaParts.length > 0 && (
          <Text style={base.meta}>{metaParts.join("   |   ")}</Text>
        )}

        <View style={base.table}>
          <View style={base.headerRow}>
            <View style={base.nameHeaderCell}>
              <Text style={base.nameHeaderText}>Student&apos;s Name</Text>
            </View>

            {subjects.map((s) => (
              <View
                key={s.id}
                style={[base.verticalHeaderCell, { width: subColWidth }]}
              >
                <Text style={base.verticalText}>{s.name}</Text>
              </View>
            ))}

            <View style={[base.verticalHeaderCell, { width: SUMMARY_COL }]}>
              <Text style={base.verticalText}>TOTAL</Text>
            </View>
            <View style={[base.verticalHeaderCell, { width: SUMMARY_COL }]}>
              <Text style={base.verticalText}>AVE.</Text>
            </View>
            <View style={[base.verticalHeaderCell, { width: SUMMARY_COL }]}>
              <Text style={base.verticalText}>Position</Text>
            </View>
          </View>

          {sorted.map((student) => {
            const subMap = new Map(
              student.subjects.map((s) => [s.subjectId, s]),
            );

            const scores = subjects.map((col) => {
              const g = subMap.get(col.id);
              if (!g) return null;
              return g[field];
            });

            const valid = scores.filter((v): v is number => v != null);
            const total = valid.reduce((sum, v) => sum + v, 0);

            return (
              <View key={student.studentId} style={base.dataRow}>
                <View style={base.nameCell}>
                  <Text style={base.nameText}>
                    {`${student.firstName} ${student.lastName}`.trim()}
                  </Text>
                </View>

                {scores.map((score, i) => (
                  <View
                    key={subjects[i].id}
                    style={[base.dataCell, { width: subColWidth }]}
                  >
                    <Text style={base.cellText}>{fmt(score)}</Text>
                  </View>
                ))}

                <View style={[base.dataCell, { width: SUMMARY_COL }]}>
                  <Text style={base.boldCell}>
                    {valid.length > 0 ? total.toFixed(1) : "-"}
                  </Text>
                </View>
                <View style={[base.dataCell, { width: SUMMARY_COL }]}>
                  <Text style={base.boldCell}>
                    {fmt(student.overallAverage)}
                  </Text>
                </View>
                <View style={[base.dataCell, { width: SUMMARY_COL }]}>
                  <Text style={base.boldCell}>
                    {student.position != null ? String(student.position) : "-"}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </Page>
    </Document>
  );
}

export async function buildEndOfYearExamPdfBuffer(
  summary: ClassSummary,
  options?: ExamReportOptions,
): Promise<Buffer> {
  return renderToBuffer(
    <EndOfYearExamDocument summary={summary} options={options} />,
  );
}
