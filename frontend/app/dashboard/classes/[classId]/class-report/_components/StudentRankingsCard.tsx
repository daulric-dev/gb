"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { ClassSummary, StudentYearReport } from "@/lib/reports";
import { getGradingRules } from "@/lib/grading-rules";

const fmtNum = (v: number | null) => (v != null ? v.toFixed(1) : "-");

interface StudentRankingsCardProps {
  isYearEnd: boolean;
  yearResults: StudentYearReport[];
  students: ClassSummary["students"];
  gradingModel?: string;
}

export function StudentRankingsCard({
  isYearEnd,
  yearResults,
  students,
  gradingModel,
}: StudentRankingsCardProps) {
  if (isYearEnd && yearResults.length > 0) {
    const rules = getGradingRules(gradingModel);
    const isPooled = rules.display.yearEndColumns === "pooled";
    const cwW = yearResults[0]?.yearCourseworkWeight ?? 40;
    const exW = yearResults[0]?.yearExamWeight ?? 60;

    const seen = new Set<string>();
    const subjectCols: { id: string; name: string }[] = [];
    for (const yr of yearResults) {
      for (const s of yr.yearEnd.subjects) {
        if (!seen.has(s.subjectId)) {
          seen.add(s.subjectId);
          subjectCols.push({ id: s.subjectId, name: s.subjectName });
        }
      }
    }

    const termNames = yearResults[0]?.terms.map((t) => t.termName) ?? [];
    const termIds = yearResults[0]?.terms.map((t) => t.termId) ?? [];
    const lastTermId = termIds.length > 0 ? termIds[termIds.length - 1] : null;

    const subHeaders = isPooled
      ? [`CA /${cwW}`, `Ex /${exW}`, "Total"]
      : [...termNames.map((n) => n.charAt(0).toUpperCase()), "E", "Yr"];

    return (
      <Card>
        <CardHeader>
          <CardTitle>Student Rankings</CardTitle>
          <CardDescription>
            Ordered by position, based on year-end overall average
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead rowSpan={2} className="w-12 align-bottom">#</TableHead>
                <TableHead rowSpan={2} className="align-bottom">Student</TableHead>
                {subjectCols.map((c) => (
                  <TableHead
                    key={c.id}
                    colSpan={subHeaders.length}
                    className="text-center border-l text-xs"
                  >
                    {c.name}
                  </TableHead>
                ))}
                <TableHead rowSpan={2} className="text-right align-bottom">
                  Year Avg
                </TableHead>
              </TableRow>
              <TableRow>
                {subjectCols.flatMap((c) =>
                  subHeaders.map((h, i) => (
                    <TableHead
                      key={`${c.id}-${i}`}
                      className={`text-center text-xs px-2 ${i === 0 ? "border-l" : ""}`}
                    >
                      {h}
                    </TableHead>
                  )),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {yearResults.map((yr) => {
                const subMap = new Map(
                  yr.yearEnd.subjects.map((s) => [s.subjectId, s]),
                );
                const lastTerm = lastTermId
                  ? yr.terms.find((t) => t.termId === lastTermId)
                  : undefined;

                return (
                  <TableRow key={yr.studentId}>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {yr.position ?? "-"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">
                      {yr.firstName} {yr.lastName}
                    </TableCell>
                    {subjectCols.flatMap((c) => {
                      const sub = subMap.get(c.id);

                      if (isPooled) {
                        const composites = (sub?.termGrades ?? [])
                          .map((g) => g.termComposite)
                          .filter((v): v is number => v != null);
                        const rawCa = composites.length > 0
                          ? composites.reduce((a, b) => a + b, 0) / composites.length
                          : null;
                        const ca = rawCa != null ? (rawCa * cwW / 100).toFixed(1) : "-";
                        const lastTermSubj = lastTerm?.subjects.find(
                          (s) => s.subjectId === c.id,
                        );
                        const rawExam = lastTermSubj?.examAverage ?? null;
                        const exam = rawExam != null ? (rawExam * exW / 100).toFixed(1) : "-";
                        return [
                          <TableCell key={`${yr.studentId}-${c.id}-ca`} className="text-center tabular-nums text-sm border-l">{ca}</TableCell>,
                          <TableCell key={`${yr.studentId}-${c.id}-ex`} className="text-center tabular-nums text-sm">{exam}</TableCell>,
                          <TableCell key={`${yr.studentId}-${c.id}-total`} className="text-center tabular-nums text-sm font-semibold">{fmtNum(sub?.yearGrade ?? null)}</TableCell>,
                        ];
                      }

                      return [
                        ...termIds.map((tid, i) => {
                          const tg = sub?.termGrades.find((g) => g.termId === tid);
                          return (
                            <TableCell key={`${yr.studentId}-${c.id}-${tid}`} className={`text-center tabular-nums text-sm ${i === 0 ? "border-l" : ""}`}>
                              {fmtNum(tg?.termComposite ?? null)}
                            </TableCell>
                          );
                        }),
                        <TableCell key={`${yr.studentId}-${c.id}-exam`} className="text-center tabular-nums text-sm">
                          {fmtNum(
                            lastTerm?.subjects.find((s) => s.subjectId === c.id)?.examAverage ?? null,
                          )}
                        </TableCell>,
                        <TableCell key={`${yr.studentId}-${c.id}-yr`} className="text-center tabular-nums text-sm font-semibold">
                          {fmtNum(sub?.yearGrade ?? null)}
                        </TableCell>,
                      ];
                    })}
                    <TableCell className="text-right tabular-nums font-semibold">
                      {yr.yearEnd.overallAverage != null
                        ? yr.yearEnd.overallAverage.toFixed(1)
                        : "-"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Student Rankings</CardTitle>
        <CardDescription>
          Ordered by position, based on overall average
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">#</TableHead>
              <TableHead>Student</TableHead>
              <TableHead className="text-right">
                Overall Average
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((st) => (
              <TableRow key={st.studentId}>
                <TableCell>
                  <Badge variant="outline" className="font-mono text-xs">
                    {st.position ?? "-"}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">
                  {st.firstName} {st.lastName}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {st.overallAverage != null
                    ? st.overallAverage.toFixed(2)
                    : "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
