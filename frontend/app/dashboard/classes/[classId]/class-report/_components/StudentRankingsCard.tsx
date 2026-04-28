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

interface StudentRankingsCardProps {
  isYearEnd: boolean;
  yearResults: StudentYearReport[];
  students: ClassSummary["students"];
}

export function StudentRankingsCard({
  isYearEnd,
  yearResults,
  students,
}: StudentRankingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Student Rankings</CardTitle>
        <CardDescription>
          {isYearEnd && yearResults.length > 0
            ? "Ordered by position, based on year-end overall average"
            : "Ordered by position, based on overall average"}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {isYearEnd && yearResults.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead>Student</TableHead>
                <TableHead className="text-right">
                  Year Average
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {yearResults.map((yr) => (
                <TableRow key={yr.studentId}>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">
                      {yr.position ?? "-"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    {yr.firstName} {yr.lastName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {yr.yearEnd.overallAverage != null
                      ? yr.yearEnd.overallAverage.toFixed(2)
                      : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
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
        )}
      </CardContent>
    </Card>
  );
}
