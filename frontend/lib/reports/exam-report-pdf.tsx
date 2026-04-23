import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import type { ClassSummary, StudentSubjectGrade } from "./api";

export interface ExamReportOptions {
  title?: string;
  className?: string;
  termName?: string;
  academicYear?: string;
  scoreField?: keyof Pick<
    StudentSubjectGrade,
    "termComposite" | "yearGrade" | "examAverage"
  >;
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

  const usable = 842 - 60; // A4 landscape minus padding
  const fixedWidth = NAME_COL + SUMMARY_COL * 3;
  const subColWidth = Math.min(
    38,
    Math.max(22, (usable - fixedWidth) / Math.max(subjects.length, 1)),
  );

  const metaParts = [
    options.className && `Class: ${options.className}`,
    options.academicYear && `Academic Year: ${options.academicYear}`,
    options.termName && `Term: ${options.termName}`,
  ].filter(Boolean);

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
          {/* ---- header ---- */}
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

          {/* ---- student rows ---- */}
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

export async function buildEndOfYearExamPdfBlob(
  summary: ClassSummary,
  options?: ExamReportOptions,
): Promise<Blob> {
  return pdf(
    <EndOfYearExamDocument summary={summary} options={options} />,
  ).toBlob();
}
