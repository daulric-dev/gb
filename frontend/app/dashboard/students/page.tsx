"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, Pencil } from "lucide-react";

interface Student {
  id: string;
  school_id: string;
  first_name: string;
  last_name: string;
  gender: "male" | "female";
  date_of_birth: string | null;
  enrollement_date: string | null;
  is_active: boolean;
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold">students</h1>
          <p className="text-muted-foreground mt-1">
            manage students in your school
          </p>
        </div>
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
      </div>

      <div className="relative animate-fade-in-up-delay-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search by name..."
          className="pl-9"
          value={search.value}
          onChange={(e) => (search.value = e.target.value)}
        />
      </div>

      {loading.value ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : students.value.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {search.value
            ? "No students match your search."
            : "No students yet. Add your first one."}
        </div>
      ) : (
        <div className="rounded-md border animate-fade-in-up-delay-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Gender</TableHead>
                <TableHead>Date of Birth</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.value.map((student) => (
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
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => (editStudent.value = student)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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

function CreateStudentForm({ onSuccess }: { onSuccess: () => void }) {
  useSignals();
  const firstName = useSignal("");
  const lastName = useSignal("");
  const gender = useSignal<"male" | "female">("male");
  const dateOfBirth = useSignal("");
  const enrollementDate = useSignal("");
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    const body: Record<string, unknown> = {
      firstName: firstName.value,
      lastName: lastName.value,
      gender: gender.value,
    };
    if (dateOfBirth.value) body.dateOfBirth = dateOfBirth.value;
    if (enrollementDate.value) body.enrollementDate = enrollementDate.value;

    try {
      await api("/students", { method: "POST", body });
      toast.success("Student created");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="firstName">First Name</Label>
          <Input
            id="firstName"
            placeholder="James"
            value={firstName.value}
            onChange={(e) => (firstName.value = e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last Name</Label>
          <Input
            id="lastName"
            placeholder="Thompson"
            value={lastName.value}
            onChange={(e) => (lastName.value = e.target.value)}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="gender">Gender</Label>
        <select
          id="gender"
          className={selectClass}
          value={gender.value}
          onChange={(e) => (gender.value = e.target.value as "male" | "female")}
          required
        >
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="dob">Date of Birth</Label>
          <Input
            id="dob"
            type="date"
            value={dateOfBirth.value}
            onChange={(e) => (dateOfBirth.value = e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="enrollDate">Enrolment Date</Label>
          <Input
            id="enrollDate"
            type="date"
            value={enrollementDate.value}
            onChange={(e) => (enrollementDate.value = e.target.value)}
          />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Creating..." : "Add Student"}
      </Button>
    </form>
  );
}

function EditStudentForm({
  student,
  onSuccess,
}: {
  student: Student;
  onSuccess: () => void;
}) {
  useSignals();
  const firstName = useSignal(student.first_name);
  const lastName = useSignal(student.last_name);
  const gender = useSignal<"male" | "female">(student.gender);
  const dateOfBirth = useSignal(student.date_of_birth ?? "");
  const enrollementDate = useSignal(student.enrollement_date ?? "");
  const isActive = useSignal(student.is_active);
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    const body: Record<string, unknown> = {
      firstName: firstName.value,
      lastName: lastName.value,
      gender: gender.value,
      dateOfBirth: dateOfBirth.value || undefined,
      enrollementDate: enrollementDate.value || undefined,
      isActive: isActive.value,
    };

    try {
      await api(`/students/${student.id}`, { method: "PATCH", body });
      toast.success("Student updated");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to update";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editFirstName">First Name</Label>
          <Input
            id="editFirstName"
            value={firstName.value}
            onChange={(e) => (firstName.value = e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editLastName">Last Name</Label>
          <Input
            id="editLastName"
            value={lastName.value}
            onChange={(e) => (lastName.value = e.target.value)}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="editGender">Gender</Label>
        <select
          id="editGender"
          className={selectClass}
          value={gender.value}
          onChange={(e) => (gender.value = e.target.value as "male" | "female")}
          required
        >
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editDob">Date of Birth</Label>
          <Input
            id="editDob"
            type="date"
            value={dateOfBirth.value}
            onChange={(e) => (dateOfBirth.value = e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editEnrollDate">Enrolment Date</Label>
          <Input
            id="editEnrollDate"
            type="date"
            value={enrollementDate.value}
            onChange={(e) => (enrollementDate.value = e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="editActive"
          type="checkbox"
          checked={isActive.value}
          onChange={(e) => (isActive.value = e.target.checked)}
          className="size-4 rounded border-input"
        />
        <Label htmlFor="editActive">Active</Label>
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
