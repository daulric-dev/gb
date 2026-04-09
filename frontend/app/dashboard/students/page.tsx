"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
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
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editStudent, setEditStudent] = useState<Student | null>(null);

  const fetchStudents = useCallback((query?: string) => {
    const params = query ? `?search=${encodeURIComponent(query)}` : "";
    api<Student[]>(`/students${params}`)
      .then(setStudents)
      .catch(() => toast.error("Failed to load students"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchStudents(search);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, fetchStudents]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold">students</h1>
          <p className="text-muted-foreground mt-1">
            manage students in your school
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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
                setCreateOpen(false);
                fetchStudents(search);
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
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : students.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {search
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
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditStudent(student)}
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
        open={editStudent !== null}
        onOpenChange={(open) => {
          if (!open) setEditStudent(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Student</DialogTitle>
            <DialogDescription>
              Update student information
            </DialogDescription>
          </DialogHeader>
          {editStudent && (
            <EditStudentForm
              student={editStudent}
              onSuccess={() => {
                setEditStudent(null);
                fetchStudents(search);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateStudentForm({ onSuccess }: { onSuccess: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [enrollementDate, setEnrolementDate] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const body: Record<string, unknown> = {
      firstName,
      lastName,
      gender,
    };
    if (dateOfBirth) body.dateOfBirth = dateOfBirth;
    if (enrollementDate) body.enrollementDate = enrollementDate;

    try {
      await api("/students", { method: "POST", body });
      toast.success("Student created");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create";
      toast.error(msg);
    } finally {
      setLoading(false);
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
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last Name</Label>
          <Input
            id="lastName"
            placeholder="Thompson"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="gender">Gender</Label>
        <select
          id="gender"
          className={selectClass}
          value={gender}
          onChange={(e) => setGender(e.target.value as "male" | "female")}
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
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="enrollDate">Enrolment Date</Label>
          <Input
            id="enrollDate"
            type="date"
            value={enrollementDate}
            onChange={(e) => setEnrolementDate(e.target.value)}
          />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Creating..." : "Add Student"}
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
  const [firstName, setFirstName] = useState(student.first_name);
  const [lastName, setLastName] = useState(student.last_name);
  const [gender, setGender] = useState<"male" | "female">(student.gender);
  const [dateOfBirth, setDateOfBirth] = useState(student.date_of_birth ?? "");
  const [enrollementDate, setEnrolementDate] = useState(
    student.enrollement_date ?? "",
  );
  const [isActive, setIsActive] = useState(student.is_active);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const body: Record<string, unknown> = {
      firstName,
      lastName,
      gender,
      dateOfBirth: dateOfBirth || undefined,
      enrollementDate: enrollementDate || undefined,
      isActive,
    };

    try {
      await api(`/students/${student.id}`, { method: "PATCH", body });
      toast.success("Student updated");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to update";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editFirstName">First Name</Label>
          <Input
            id="editFirstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editLastName">Last Name</Label>
          <Input
            id="editLastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="editGender">Gender</Label>
        <select
          id="editGender"
          className={selectClass}
          value={gender}
          onChange={(e) => setGender(e.target.value as "male" | "female")}
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
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editEnrollDate">Enrolment Date</Label>
          <Input
            id="editEnrollDate"
            type="date"
            value={enrollementDate}
            onChange={(e) => setEnrolementDate(e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="editActive"
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="size-4 rounded border-input"
        />
        <Label htmlFor="editActive">Active</Label>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
