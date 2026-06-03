import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { StudentTermResult } from "@/calculation/interfaces/calculation.interfaces";
import { getGradingRules } from "./grading-rules";

export interface StudentReportOptions {
  termName?: string;
  academicYear?: string;
  className?: string;
  totalStudents?: number;
  schoolName?: string;
  gradingModel?: string;
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

function fmt(v: number | null): string {
  return v != null ? v.toFixed(1) : "-";
}

const BW = 0.75;
const BORDER = "#000";

const s = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
  },

  schoolName: {
    fontSize: 14,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  title: {
    fontSize: 12,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
    marginBottom: 16,
  },
  studentName: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginBottom: 14,
  },

  /* ---- info header (TERM / YEAR / CLASS / etc.) ---- */
  infoBlock: {
    borderWidth: BW,
    borderColor: BORDER,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    borderBottomWidth: BW,
    borderColor: BORDER,
    minHeight: 22,
  },
  infoRowLast: {
    flexDirection: "row",
    minHeight: 22,
  },
  infoCell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  infoCellBorder: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRightWidth: BW,
    borderColor: BORDER,
  },
  infoLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  infoValue: {
    fontSize: 9,
    marginLeft: 4,
  },

  /* ---- grades table ---- */
  table: {
    borderWidth: BW,
    borderColor: BORDER,
  },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: BW,
    borderColor: BORDER,
    backgroundColor: "#f5f5f5",
    minHeight: 32,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: BW,
    borderColor: BORDER,
    minHeight: 22,
  },
  rowLast: {
    flexDirection: "row",
    minHeight: 22,
  },

  subjectCol: {
    width: "40%",
    borderRightWidth: BW,
    borderColor: BORDER,
    justifyContent: "center",
    paddingLeft: 8,
    paddingVertical: 3,
  },
  scoreCol: {
    width: "15%",
    borderRightWidth: BW,
    borderColor: BORDER,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 3,
  },
  gradeCol: {
    width: "15%",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 3,
  },

  headerText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
  },
  subjectText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  cellText: {
    fontSize: 9,
  },
  cellTextBold: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },

  /* ---- summary row ---- */
  summaryRow: {
    flexDirection: "row",
    minHeight: 24,
    backgroundColor: "#f0f0f0",
  },

  /* ---- footer ---- */
  footer: {
    marginTop: 24,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerBlock: {
    width: "45%",
  },
  footerLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  footerLine: {
    borderBottomWidth: 0.5,
    borderColor: BORDER,
    marginTop: 20,
    width: "100%",
  },
  footerLineLabel: {
    fontSize: 7,
    color: "#666",
    marginTop: 2,
  },
});

export function StudentReportDocument({
  result,
  options = {},
}: {
  result: StudentTermResult;
  options?: StudentReportOptions;
}) {
  const name = `${result.firstName} ${result.lastName}`.trim();
  const rules = getGradingRules(options.gradingModel);
  const hasTermExam = rules.termHasExam;

  const validScores = result.subjects
    .map((sub) => sub.termComposite)
    .filter((v): v is number => v != null);
  const total = validScores.reduce((sum, v) => sum + v, 0);

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* School name */}
        {options.schoolName && (
          <Text style={s.schoolName}>{options.schoolName}</Text>
        )}

        <Text style={s.title}>STUDENT REPORT CARD</Text>

        {/* Student name */}
        <Text style={s.studentName}>{name}</Text>

        {/* ---- info header ---- */}
        <View style={s.infoBlock}>
          <View style={s.infoRow}>
            <View style={s.infoCellBorder}>
              <Text style={s.infoLabel}>TERM</Text>
              <Text style={s.infoValue}>{(options.termName ?? "").toUpperCase()}</Text>
            </View>
            <View style={s.infoCell}>
              <Text style={s.infoLabel}>YEAR</Text>
              <Text style={s.infoValue}>{options.academicYear ?? ""}</Text>
            </View>
          </View>

          <View style={s.infoRow}>
            <View style={s.infoCellBorder}>
              <Text style={s.infoLabel}>CLASS</Text>
              <Text style={s.infoValue}>{options.className ?? ""}</Text>
            </View>
            <View style={s.infoCell}>
              <Text style={s.infoLabel}>NO. IN CLASS</Text>
              <Text style={s.infoValue}>
                {options.totalStudents != null
                  ? String(options.totalStudents)
                  : ""}
              </Text>
            </View>
          </View>

          <View style={s.infoRow}>
            <View style={s.infoCellBorder}>
              <Text style={s.infoLabel}>POSITION</Text>
              <Text style={s.infoValue}>
                {result.position != null ? String(result.position) : ""}
              </Text>
            </View>
            <View style={s.infoCell}>
              <Text style={s.infoLabel}>OVERALL AVERAGE</Text>
              <Text style={s.infoValue}>{fmt(result.overallAverage)}</Text>
            </View>
          </View>

          <View style={s.infoRowLast}>
            <View style={s.infoCellBorder}>
              <Text style={s.infoLabel}>POSSIBLE ATTENDANCE</Text>
              <Text style={s.infoValue} />
            </View>
            <View style={s.infoCell}>
              <Text style={s.infoLabel}>TIMES ABSENT</Text>
              <Text style={s.infoValue} />
            </View>
          </View>
        </View>

        {/* ---- grades table ---- */}
        <View style={s.table}>
          {/* Header */}
          <View style={s.headerRow}>
            <View style={s.subjectCol}>
              <Text style={s.headerText}>SUBJECT</Text>
            </View>
            <View style={s.scoreCol}>
              <Text style={s.headerText}>COURSE{"\n"}WORK %</Text>
            </View>
            {hasTermExam && (
              <View style={s.scoreCol}>
                <Text style={s.headerText}>Final{"\n"}Exam %</Text>
              </View>
            )}
            <View style={s.scoreCol}>
              <Text style={s.headerText}>Total</Text>
            </View>
            <View style={s.gradeCol}>
              <Text style={s.headerText}>GRADE</Text>
            </View>
          </View>

          {/* Subject rows */}
          {result.subjects.map((sub, i) => {
            const isLast =
              i === result.subjects.length - 1 && validScores.length === 0;
            return (
              <View key={sub.subjectId} style={isLast ? s.rowLast : s.row}>
                <View style={s.subjectCol}>
                  <Text style={s.subjectText}>
                    {sub.subjectName.toUpperCase()}
                  </Text>
                </View>
                <View style={s.scoreCol}>
                  <Text style={s.cellText}>{fmt(sub.courseworkAverage)}</Text>
                </View>
                {hasTermExam && (
                  <View style={s.scoreCol}>
                    <Text style={s.cellText}>{fmt(sub.examAverage)}</Text>
                  </View>
                )}
                <View style={s.scoreCol}>
                  <Text style={s.cellTextBold}>{fmt(sub.termComposite)}</Text>
                </View>
                <View style={s.gradeCol}>
                  <Text style={s.cellTextBold}>
                    {computeLetterGrade(sub.termComposite)}
                  </Text>
                </View>
              </View>
            );
          })}

          {/* Summary row */}
          {validScores.length > 0 && (
            <View style={s.summaryRow}>
              <View style={s.subjectCol}>
                <Text style={s.cellTextBold}>TOTAL / AVERAGE</Text>
              </View>
              <View style={s.scoreCol}>
                <Text style={s.cellText} />
              </View>
              {hasTermExam && (
                <View style={s.scoreCol}>
                  <Text style={s.cellText} />
                </View>
              )}
              <View style={s.scoreCol}>
                <Text style={s.cellTextBold}>{total.toFixed(1)}</Text>
              </View>
              <View style={s.gradeCol}>
                <Text style={s.cellTextBold}>
                  {fmt(result.overallAverage)}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* ---- signature footer ---- */}
        <View style={s.footer}>
          <View style={s.footerBlock}>
            <View style={s.footerLine} />
            <Text style={s.footerLineLabel}>Class Teacher&apos;s Signature</Text>
          </View>
          <View style={s.footerBlock}>
            <View style={s.footerLine} />
            <Text style={s.footerLineLabel}>Principal&apos;s Signature</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function buildStudentReportPdfBuffer(
  result: StudentTermResult,
  options?: StudentReportOptions,
): Promise<Buffer> {
  return renderToBuffer(
    <StudentReportDocument result={result} options={options} />,
  );
}
