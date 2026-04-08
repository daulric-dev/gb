"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Plus, Trash2, BookOpen, UserPlus, X } from "lucide-react";

interface ClassInfo {
  id: string;
  name: string;
  academicYearId: string;
  isClassTeacher: boolean;
}

interface EnrolledStudent {
  id: string;
  enrolled_at: string;
  student: {
    id: string;
    first_name: string;
    last_name: string;
    gender: string;
    date_of_birth: string | null;
    is_active: boolean;
  };
}

interface Student {
  id: string;
  first_name: string;
  last_name: string;
  gender: string;
  is_active: boolean;
}

interface Subject {
  id: string;
  name: string;
  code: string;
  is_graded: boolean;
  sort_order: number;
}

interface StudentSubject {
  id: number;
  subject: Subject | null;
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function ClassDetailPage() {
  const params = useParams();
  const router = useRouter();
  const classId = params.classId as string;

  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null);
  const [enrolled, setEnrolled] = useState<EnrolledStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [subjectStudent, setSubjectStudent] = useState<EnrolledStudent | null>(null);

  const fetchData = useCallback(() => {
    Promise.all([
      api<ClassInfo[]>("/classes").then((cls) => cls.find((c) => c.id === classId) ?? null),
      api<EnrolledStudent[]>(`/classes/${classId}/students`).catch(() => []),
    ]).then(([info, students]) => {
      setClassInfo(info);
      setEnrolled(students);
      setLoading(false);
    });
  }, [classId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleUnenroll(studentId: string, name: string) {
    if (!confirm(`Unenroll ${name}? This will also remove their subject assignments.`)) return;

    try {
      await api(`/classes/${classId}/enroll/${studentId}`, { method: "DELETE" });
      toast.success(`${name} unenrolled`);
      fetchData();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to unenroll";
      toast.error(msg);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!classInfo) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/classes")}>
          <ArrowLeft className="mr-2 size-4" /> Back to Classes
        </Button>
        <div className="text-center py-12 text-muted-foreground">
          Class not found or you don't have access.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push("/dashboard/classes")}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{classInfo.name}</h1>
            <p className="text-muted-foreground mt-1">
              {classInfo.isClassTeacher ? "You are the class teacher" : "You teach subjects in this class"}
            </p>
          </div>
        </div>

        {classInfo.isClassTeacher && (
          <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
            <DialogTrigger render={<Button />}>
              <UserPlus className="mr-2 size-4" />
              Enroll Students
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Enroll Students</DialogTitle>
                <DialogDescription>
                  Select students to enroll in {classInfo.name}
                </DialogDescription>
              </DialogHeader>
              <EnrollForm
                classId={classId}
                enrolledIds={enrolled.map((e) => e.student.id)}
                onSuccess={() => {
                  setEnrollOpen(false);
                  fetchData();
                }}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="animate-fade-in-up-delay-1">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Enrolled Students</CardTitle>
              <CardDescription>
                {enrolled.length} student{enrolled.length !== 1 ? "s" : ""} enrolled
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {enrolled.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No students enrolled yet. {classInfo.isClassTeacher ? "Click \"Enroll Students\" to add some." : ""}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Gender</TableHead>
                    <TableHead>Enrolled</TableHead>
                    <TableHead>Subjects</TableHead>
                    {classInfo.isClassTeacher && (
                      <TableHead className="text-right">Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrolled.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">
                        {e.student.first_name} {e.student.last_name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {e.student.gender}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(e.enrolled_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSubjectStudent(e)}
                        >
                          <BookOpen className="mr-1 size-3" />
                          Manage
                        </Button>
                      </TableCell>
                      {classInfo.isClassTeacher && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              handleUnenroll(
                                e.student.id,
                                `${e.student.first_name} ${e.student.last_name}`,
                              )
                            }
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={subjectStudent !== null}
        onOpenChange={(open) => {
          if (!open) setSubjectStudent(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Subjects — {subjectStudent?.student.first_name} {subjectStudent?.student.last_name}
            </DialogTitle>
            <DialogDescription>
              Manage subject assignments for this student
            </DialogDescription>
          </DialogHeader>
          {subjectStudent && (
            <ManageSubjects
              classId={classId}
              studentId={subjectStudent.student.id}
              studentName={`${subjectStudent.student.first_name} ${subjectStudent.student.last_name}`}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EnrollForm({
  classId,
  enrolledIds,
  onSuccess,
}: {
  classId: string;
  enrolledIds: string[];
  onSuccess: () => void;
}) {
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api<Student[]>("/students")
      .then((students) => {
        setAllStudents(students.filter((s) => s.is_active));
      })
      .catch(() => toast.error("Failed to load students"))
      .finally(() => setLoading(false));
  }, []);

  const available = allStudents.filter((s) => !enrolledIds.includes(s.id));

  function toggleStudent(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleEnroll() {
    if (selected.size === 0) return;
    setSubmitting(true);

    try {
      if (selected.size === 1) {
        const [studentId] = selected;
        await api(`/classes/${classId}/enroll`, {
          method: "POST",
          body: { studentId },
        });
      } else {
        await api(`/classes/${classId}/enroll/bulk`, {
          method: "POST",
          body: { studentIds: [...selected] },
        });
      }
      toast.success(`${selected.size} student${selected.size > 1 ? "s" : ""} enrolled`);
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to enroll";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (available.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground">
        All students are already enrolled in this class.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
        {available.map((s) => (
          <label
            key={s.id}
            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors"
          >
            <input
              type="checkbox"
              checked={selected.has(s.id)}
              onChange={() => toggleStudent(s.id)}
              className="size-4 rounded border-input"
            />
            <span className="text-sm font-medium">
              {s.first_name} {s.last_name}
            </span>
            <Badge variant="outline" className="ml-auto capitalize text-xs">
              {s.gender}
            </Badge>
          </label>
        ))}
      </div>
      <Button
        className="w-full"
        disabled={selected.size === 0 || submitting}
        onClick={handleEnroll}
      >
        {submitting
          ? "Enrolling..."
          : `Enroll ${selected.size} Student${selected.size !== 1 ? "s" : ""}`}
      </Button>
    </div>
  );
}

function ManageSubjects({
  classId,
  studentId,
  studentName,
}: {
  classId: string;
  studentId: string;
  studentName: string;
}) {
  const [assigned, setAssigned] = useState<StudentSubject[]>([]);
  const [allSubjects, setAllSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const fetchSubjects = useCallback(() => {
    Promise.all([
      api<StudentSubject[]>(`/classes/${classId}/students/${studentId}/subjects`).catch(() => []),
      api<Subject[]>("/subjects").catch(() => []),
    ]).then(([studentSubjects, subjects]) => {
      setAssigned(studentSubjects);
      setAllSubjects(subjects);
      setLoading(false);
    });
  }, [classId, studentId]);

  useEffect(() => {
    fetchSubjects();
  }, [fetchSubjects]);

  async function handleRemove(subjectId: string, subjectName: string) {
    if (!confirm(`Remove ${subjectName} from ${studentName}?`)) return;

    try {
      await api(`/classes/${classId}/students/${studentId}/subjects/${subjectId}`, {
        method: "DELETE",
      });
      toast.success(`${subjectName} removed`);
      fetchSubjects();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to remove";
      toast.error(msg);
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const assignedSubjectIds = new Set(
    assigned.map((a) => a.subject?.id).filter(Boolean),
  );
  const availableSubjects = allSubjects.filter(
    (s) => !assignedSubjectIds.has(s.id),
  );

  return (
    <div className="space-y-4">
      {assigned.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No subjects assigned yet
        </div>
      ) : (
        <div className="rounded-md border divide-y">
          {assigned.map((a) =>
            a.subject ? (
              <div
                key={a.id}
                className="flex items-center justify-between px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{a.subject.name}</span>
                  {a.subject.code && (
                    <Badge variant="secondary" className="text-xs">
                      {a.subject.code}
                    </Badge>
                  )}
                  {!a.subject.is_graded && (
                    <Badge variant="outline" className="text-xs">
                      Not graded
                    </Badge>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(a.subject!.id, a.subject!.name)}
                >
                  <X className="size-4 text-destructive" />
                </Button>
              </div>
            ) : null,
          )}
        </div>
      )}

      {addOpen ? (
        <AddSubjectsForm
          classId={classId}
          studentId={studentId}
          available={availableSubjects}
          onSuccess={() => {
            setAddOpen(false);
            fetchSubjects();
          }}
          onCancel={() => setAddOpen(false)}
        />
      ) : (
        <Button
          variant="outline"
          className="w-full"
          disabled={availableSubjects.length === 0}
          onClick={() => setAddOpen(true)}
        >
          <Plus className="mr-2 size-4" />
          {availableSubjects.length === 0 ? "All subjects assigned" : "Add Subjects"}
        </Button>
      )}
    </div>
  );
}

function AddSubjectsForm({
  classId,
  studentId,
  available,
  onSuccess,
  onCancel,
}: {
  classId: string;
  studentId: string;
  available: Subject[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  function toggleSubject(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAssign() {
    if (selected.size === 0) return;
    setSubmitting(true);

    try {
      await api(`/classes/${classId}/subjects`, {
        method: "POST",
        body: { studentId, subjectIds: [...selected] },
      });
      toast.success(`${selected.size} subject${selected.size > 1 ? "s" : ""} assigned`);
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to assign";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="max-h-48 overflow-y-auto divide-y">
        {available.map((s) => (
          <label
            key={s.id}
            className="flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-accent/50 transition-colors rounded-sm"
          >
            <input
              type="checkbox"
              checked={selected.has(s.id)}
              onChange={() => toggleSubject(s.id)}
              className="size-4 rounded border-input"
            />
            <span className="text-sm font-medium">{s.name}</span>
            {s.code && (
              <Badge variant="secondary" className="text-xs ml-auto">
                {s.code}
              </Badge>
            )}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={selected.size === 0 || submitting}
          onClick={handleAssign}
          className="flex-1"
        >
          {submitting ? "Assigning..." : `Assign ${selected.size}`}
        </Button>
      </div>
    </div>
  );
}
