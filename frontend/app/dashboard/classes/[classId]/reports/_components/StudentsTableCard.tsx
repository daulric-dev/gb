import Link from "next/link";
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
import { Skeleton } from "@/components/ui/skeleton";
import { type StudentRow } from "./types";

interface StudentsTableCardProps {
  students: StudentRow[];
  dataLoading: boolean;
  studentDetailHref: (studentId: string) => string;
}

export function StudentsTableCard({
  students,
  dataLoading,
  studentDetailHref,
}: StudentsTableCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Students</CardTitle>
        <CardDescription>
          Click a student to view detailed grades and download their report as PDF.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {dataLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : students.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No students or grades found for this term.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Student</TableHead>
                <TableHead className="text-right">Average</TableHead>
                <TableHead className="text-right w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s) => (
                <TableRow key={s.studentId}>
                  <TableCell className="text-muted-foreground">
                    {s.position ?? "-"}
                  </TableCell>
                  <TableCell className="font-medium">
                    {s.firstName} {s.lastName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.overallAverage != null
                      ? s.overallAverage.toFixed(2)
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={studentDetailHref(s.studentId)}
                      className="inline-flex h-7 items-center justify-center rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium hover:bg-muted"
                    >
                      View
                    </Link>
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
