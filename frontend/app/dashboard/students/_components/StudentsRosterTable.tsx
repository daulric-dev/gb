"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronRight, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Student } from "./types";

export function StudentsRosterTable({
  students,
  onEdit,
  canEdit = true,
}: {
  students: Student[];
  onEdit: (student: Student) => void;
  canEdit?: boolean;
}) {
  const router = useRouter();

  return (
    <div className="animate-fade-in-up-delay-1 rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Gender</TableHead>
            <TableHead>Date of Birth</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Account</TableHead>
            {canEdit && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.map((student) => (
            <TableRow
              key={student.id}
              // The whole row opens the profile; the edit button stops the
              // click so it does not navigate out from under the dialog.
              onClick={() => router.push(`/dashboard/students/${student.id}`)}
              className="cursor-pointer"
            >
              <TableCell className="font-medium">
                <span className="inline-flex items-center gap-1.5">
                  {student.first_name} {student.last_name}
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="capitalize">
                  {student.gender}
                </Badge>
              </TableCell>
              <TableCell>
                {student.date_of_birth
                  ? new Date(student.date_of_birth).toLocaleDateString()
                  : "-"}
              </TableCell>
              <TableCell>
                {student.is_active ? (
                  <Badge>Active</Badge>
                ) : (
                  <Badge variant="secondary">Inactive</Badge>
                )}
              </TableCell>
              <TableCell>
                {student.user_profile_id ? (
                  <Badge variant="secondary">Linked</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    No account
                  </span>
                )}
              </TableCell>
              {canEdit && (
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(student);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
