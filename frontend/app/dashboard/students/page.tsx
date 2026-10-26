"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { usePermissions } from "@/providers/PermissionsProvider";
import { PermissionDenied } from "@/components/dashboard/permission-denied";
import { KeyRound } from "lucide-react";
import type { Student } from "./_components/types";
import { StudentsSearchField } from "./_components/StudentsSearchField";
import { StudentsRosterTable } from "./_components/StudentsRosterTable";
import { EditStudentForm } from "./_components/EditStudentForm";
import { SchoolJoinCodeDialog } from "./_components/SchoolJoinCodeDialog";

export default function StudentsPage() {
  useSignals();
  const { can } = usePermissions();
  const students = useSignal<Student[]>([]);
  const loading = useSignal(true);
  const search = useSignal("");
  const editStudent = useSignal<Student | null>(null);
  const joinCodeOpen = useSignal(false);

  const fetchStudents = useCallback((query?: string) => {
    const params = query ? `?search=${encodeURIComponent(query)}` : "";
    api<Student[]>(`/students${params}`)
      .then((data) => (students.value = data))
      .catch(() => toast.error("Failed to load students"))
      .finally(() => (loading.value = false));
  }, [loading, students]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchStudents(search.value);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search.value, fetchStudents]);

  if (!can("student", "read")) {
    return (
      <PermissionDenied
        title="Students"
        description="Manage student records for your school"
        message="You do not have permission to view students."
      />
    );
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Students"
        description="Manage Students in Your School"
        action={
          can("join-code", "read") || can("join-code", "update") ? (
            <Button onClick={() => (joinCodeOpen.value = true)}>
              <KeyRound className="mr-2 size-4" />
              School join code
            </Button>
          ) : undefined
        }
      />

      <p className="text-sm text-muted-foreground">
        Students join with your school code. They sign up, enter the code, and
        appear here once they have joined.
      </p>

      <StudentsSearchField
        value={search.value}
        onChange={(e) => (search.value = e.target.value)}
      />

      {loading.value ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : students.value.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          {search.value
            ? "No students match your search."
            : "No students yet. Share your school join code so students can join."}
        </div>
      ) : (
        <StudentsRosterTable
          students={students.value}
          onEdit={(student) => (editStudent.value = student)}
          canEdit={can("student", "update")}
        />
      )}

      <Dialog
        open={editStudent.value !== null}
        onOpenChange={(open) => {
          if (!open) editStudent.value = null;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Student</DialogTitle>
            <DialogDescription>
              Update student information
            </DialogDescription>
          </DialogHeader>
          {editStudent.value && (
            <EditStudentForm
              student={editStudent.value}
              onSuccess={() => {
                editStudent.value = null;
                fetchStudents(search.value);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <SchoolJoinCodeDialog
        open={joinCodeOpen.value}
        onOpenChangeAction={(v) => (joinCodeOpen.value = v)}
        canIssue={can("join-code", "update")}
      />
    </div>
  );
}
