"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KeyRound, Pencil } from "lucide-react";
import type { Student } from "./types";

export function StudentsRosterTable({
  students,
  onEdit,
  onManageAccount,
  canEdit = true,
}: {
  students: Student[];
  onEdit: (student: Student) => void;
  onManageAccount?: (student: Student) => void;
  canEdit?: boolean;
}) {
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
            <TableRow key={student.id}>
              <TableCell className="font-medium">
                {student.first_name} {student.last_name}
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
                ) : onManageAccount ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onManageAccount(student)}
                  >
                    <KeyRound className="mr-1.5 size-3.5" />
                    Claim code
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    No account
                  </span>
                )}
              </TableCell>
              {canEdit && (
                <TableCell className="text-right">
                  {onManageAccount && student.user_profile_id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Student account"
                      onClick={() => onManageAccount(student)}
                    >
                      <KeyRound className="size-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => onEdit(student)}>
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
