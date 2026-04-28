"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ClassItem } from "./types";

export function ClassTable({
  classes,
  yearMap,
  emptyMessage,
}: {
  classes: ClassItem[];
  yearMap: Map<string, string>;
  emptyMessage: string;
}) {
  const router = useRouter();

  if (classes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Academic Year</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {classes.map((cls) => (
            <TableRow
              key={cls.id}
              className="cursor-pointer"
              onClick={() => router.push(`/dashboard/classes/${cls.id}`)}
            >
              <TableCell className="font-medium">{cls.name}</TableCell>
              <TableCell>
                <Badge variant="outline">
                  {yearMap.get(cls.academicYearId) ?? "-"}
                </Badge>
              </TableCell>
              <TableCell>
                {new Date(cls.createdAt).toLocaleDateString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
