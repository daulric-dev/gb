"use client";

import {
  Card,
  CardContent,
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
import type { ClassSummary } from "@/lib/reports";

interface SubjectAveragesCardProps {
  subjectAverages: ClassSummary["subjectAverages"];
}

export function SubjectAveragesCard({ subjectAverages }: SubjectAveragesCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Subject Averages</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              <TableHead className="text-right">Average</TableHead>
              <TableHead className="text-right">Highest</TableHead>
              <TableHead className="text-right">Lowest</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subjectAverages.map((sub) => (
              <TableRow key={sub.subjectId}>
                <TableCell className="font-medium">
                  {sub.subjectName}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {sub.average != null ? sub.average.toFixed(2) : "-"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {sub.highestMark != null
                    ? sub.highestMark.toFixed(1)
                    : "-"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {sub.lowestMark != null
                    ? sub.lowestMark.toFixed(1)
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
