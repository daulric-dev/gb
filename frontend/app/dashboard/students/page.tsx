"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Plus } from "lucide-react";
import type { Student } from "./_components/types";
import { StudentsSearchField } from "./_components/StudentsSearchField";
import { StudentsRosterTable } from "./_components/StudentsRosterTable";
import { CreateStudentForm } from "./_components/CreateStudentForm";
import { EditStudentForm } from "./_components/EditStudentForm";

export default function StudentsPage() {
  useSignals();
  const students = useSignal<Student[]>([]);
  const loading = useSignal(true);
  const search = useSignal("");
  const createOpen = useSignal(false);
  const editStudent = useSignal<Student | null>(null);

  const fetchStudents = useCallback((query?: string) => {
    const params = query ? `?search=${encodeURIComponent(query)}` : "";
    api<Student[]>(`/students${params}`)
      .then((data) => (students.value = data))
      .catch(() => toast.error("Failed to load students"))
      .finally(() => (loading.value = false));
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchStudents(search.value);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search.value, fetchStudents]);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Students"
        description="Manage Students in Your School"
        action={
          <Dialog open={createOpen.value} onOpenChange={(v) => (createOpen.value = v)}>
            <DialogTrigger render={<Button />}>
              <Plus className="mr-2 size-4" />
              New Student
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Student</DialogTitle>
                <DialogDescription>
                  Create a new student record for your school
                </DialogDescription>
              </DialogHeader>
              <CreateStudentForm
                onSuccess={() => {
                  createOpen.value = false;
                  fetchStudents(search.value);
                }}
              />
            </DialogContent>
          </Dialog>
        }
      />

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
            : "No students yet. Add your first one."}
        </div>
      ) : (
        <StudentsRosterTable
          students={students.value}
          onEdit={(student) => (editStudent.value = student)}
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
    </div>
  );
}
