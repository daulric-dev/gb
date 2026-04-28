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

const fmtNum = (v: number | null) => (v != null ? v.toFixed(1) : "-");

interface YearEndResultsCardProps {
  yr: StudentYearReport;
}

export function YearEndResultsCard({ yr }: YearEndResultsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Year-End Subject Results</CardTitle>
        <CardDescription>
          Each term composite and year grade, calculated live from
          assessments.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {yr.yearEnd.subjects.map((sub) => {
              const lastTerm = yr.terms[yr.terms.length - 1];
              const lastTermSubject = lastTerm?.subjects.find(
                (s) => s.subjectId === sub.subjectId,
              );
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
