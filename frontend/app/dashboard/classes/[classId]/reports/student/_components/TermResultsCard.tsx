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
import { type StudentTermResult } from "@/lib/reports";

const fmtNum = (v: number | null) => (v != null ? v.toFixed(1) : "-");

interface TermResultsCardProps {
  tr: StudentTermResult;
}

export function TermResultsCard({ tr }: TermResultsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Subject Results</CardTitle>
        <CardDescription>
          Live calculated grades from assessments.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              <TableHead className="text-right">Coursework</TableHead>
              <TableHead className="text-right">Exam</TableHead>
              <TableHead className="text-right">Term</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tr.subjects.map((sub) => (
              <TableRow key={sub.subjectId}>
                <TableCell className="font-medium">
                  {sub.subjectName}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {fmtNum(sub.courseworkAverage)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {fmtNum(sub.examAverage)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtNum(sub.termComposite)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
