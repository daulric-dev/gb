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
import { type StudentYearReport } from "@/lib/reports";
import { getGradingRules } from "@/lib/grading-rules";

const fmtNum = (v: number | null) => (v != null ? v.toFixed(1) : "-");

interface YearEndResultsCardProps {
  yr: StudentYearReport;
}

export function YearEndResultsCard({ yr }: YearEndResultsCardProps) {
  const rules = getGradingRules(yr.gradingModel);
  const cwWeight = yr.yearCourseworkWeight ?? 40;
  const exWeight = yr.yearExamWeight ?? 60;
  const isPooled = rules.display.yearEndColumns === "pooled";

  const scaleValue = (raw: number | null, weight: number) =>
    raw != null ? (raw * weight / 100).toFixed(1) : "-";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Year-End Subject Results</CardTitle>
        <CardDescription>
          {isPooled
            ? `Coursework (${cwWeight}%) and final exam (${exWeight}%) combined into total.`
            : "Each term composite and year grade, calculated live from assessments."}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              {isPooled ? (
                <>
                  <TableHead className="text-right">CA /{cwWeight}</TableHead>
                  <TableHead className="text-right">Exam /{exWeight}</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </>
              ) : (
                <>
                  {yr.terms.map((t) => (
                    <TableHead
                      key={t.termId}
                      className="text-right"
                      title={t.termName}
                    >
                      {t.termName.charAt(0).toUpperCase()}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">End of Yr Exam</TableHead>
                  <TableHead className="text-right">Year Grade</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {yr.yearEnd.subjects.map((sub) => {
              const lastTerm = yr.terms[yr.terms.length - 1];
              const lastTermSubject = lastTerm?.subjects.find(
                (s) => s.subjectId === sub.subjectId,
              );

              if (isPooled) {
                const composites = sub.termGrades
                  .map((g) => g.termComposite)
                  .filter((v): v is number => v != null);
                const rawCa = composites.length > 0
                  ? composites.reduce((a, b) => a + b, 0) / composites.length
                  : null;
                const rawExam = lastTermSubject?.examAverage ?? null;

                return (
                  <TableRow key={sub.subjectId}>
                    <TableCell className="font-medium">
                      {sub.subjectName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {scaleValue(rawCa, cwWeight)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {scaleValue(rawExam, exWeight)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {fmtNum(sub.yearGrade)}
                    </TableCell>
                  </TableRow>
                );
              }

              return (
                <TableRow key={sub.subjectId}>
                  <TableCell className="font-medium">
                    {sub.subjectName}
                  </TableCell>
                  {yr.terms.map((t) => {
                    const tg = sub.termGrades.find(
                      (g) => g.termId === t.termId,
                    );
                    return (
                      <TableCell
                        key={t.termId}
                        className="text-right tabular-nums text-muted-foreground"
                      >
                        {fmtNum(tg?.termComposite ?? null)}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {fmtNum(lastTermSubject?.examAverage ?? null)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {fmtNum(sub.yearGrade)}
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
