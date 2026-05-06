"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Plus, Trash2, BookOpen, UserPlus, ClipboardList, GraduationCap, Pencil, BarChart3, ChevronLeft, ChevronRight, ScrollText, FileBarChart, ListChecks, Download } from "lucide-react";
import {
  buildEndOfYearExamPdfBlob,
  downloadBlob,
  type ClassSummary,
  type StudentSubjectGrade,
} from "@/lib/reports";
import { EnrollForm } from "./_components/EnrollForm";
import { ManageSubjects } from "./_components/ManageSubjects";
import { EditTeacherSubjectsForm } from "./_components/EditTeacherSubjectsForm";
import { AssignTeacherForm } from "./_components/AssignTeacherForm";
import { BulkAssignSubjects } from "./_components/BulkAssignSubjects";
import type { EnrolledStudent, TeacherAssignment } from "./_components/types";

interface ClassInfo {
  id: string;
  name: string;
  academicYearId: string;
  isClassTeacher: boolean;
}

interface Term {
  id: string;
  name: string;
  sort_order: number;
}

interface SummarySubject {
  subjectId: string;
  subjectName: string;
  average: number | null;
}

interface SummaryRow {
  student: { id: string; firstName: string; lastName: string };
  subjects: SummarySubject[];
  overallAverage: number | null;
  position: number;
}

interface YearEndSubject {
  subjectId: string;
  subjectName: string;
  yearGrade: number | null;
  termGrades: { termId: string; termName: string; termComposite: number | null }[];
}

interface YearResultRow {
  studentId: string;
  firstName: string;
  lastName: string;
  gradingModel: string;
  terms: {
    termId: string;
    termName: string;
    subjects: { subjectId: string; termComposite: number | null }[];
    overallAverage: number | null;
  }[];
  yearEnd: {
    subjects: YearEndSubject[];
    overallAverage: number | null;
  };
  position?: number;
}

const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function ClassDetailPage() {
  useSignals();
  const params = useParams();
  const router = useRouter();
  const classId = params?.classId as string;

  const classInfo = useSignal<ClassInfo | null>(null);
  const enrolled = useSignal<EnrolledStudent[]>([]);
  const loading = useSignal(true);
  const enrollOpen = useSignal(false);
  const subjectStudent = useSignal<EnrolledStudent | null>(null);
  const teachers = useSignal<TeacherAssignment[]>([]);
  const assignTeacherOpen = useSignal(false);
  const editingTeacher = useSignal<TeacherAssignment | null>(null);
  const bulkAssignOpen = useSignal(false);
  const terms = useSignal<Term[]>([]);
  const selectedTermId = useSignal("");
  const summaryData = useSignal<SummaryRow[]>([]);
  const summaryLoading = useSignal(false);
  const summaryView = useSignal<"term" | "year">("term");
  const yearData = useSignal<YearResultRow[]>([]);
  const yearLoading = useSignal(false);
  const gradingModel = useSignal<string>("term_based");
  const summaryPage = useSignal(0);
  const summaryPageSize = useSignal(10);
  const yearPage = useSignal(0);
  const yearPageSize = useSignal(10);
  const generatingReport = useSignal(false);

  const generateReport = async () => {
    const info = classInfo.value;
    if (!info) return;
    generatingReport.value = true;
    try {
      const className = info.name;
      const selectedTerm = terms.value.find((t) => t.id === selectedTermId.value);
      const termLabel = selectedTerm?.name ?? "";

      if (summaryView.value === "year" && yearData.value.length > 0) {
        const students: ClassSummary["students"] = yearData.value.map((row) => ({
          studentId: row.studentId,
          firstName: row.firstName,
          lastName: row.lastName,
          overallAverage: row.yearEnd.overallAverage,
          position: row.position ?? null,
          subjects: row.yearEnd.subjects.map((sub): StudentSubjectGrade => ({
            subjectId: sub.subjectId,
            subjectName: sub.subjectName,
            courseworkAverage: null,
            examAverage: null,
            termComposite: null,
            yearGrade: sub.yearGrade,
          })),
        }));

        const summary: ClassSummary = {
          classAverage: null,
          highestAverage: null,
          lowestAverage: null,
          totalStudents: students.length,
          passCount: 0,
          failCount: 0,
          courseworkWeight: 0,
          examWeight: 0,
          gradingModel: "year_based",
          subjectAverages: [],
          students,
        };

        const blob = await buildEndOfYearExamPdfBlob(summary, {
          title: "END OF YEAR EXAMINATIONS",
          className,
          scoreField: "yearGrade",
        });
        downloadBlob(blob, `${className}_year_exam_report.pdf`);
      } else if (summaryData.value.length > 0) {
        const students: ClassSummary["students"] = summaryData.value.map((row) => ({
          studentId: row.student.id,
          firstName: row.student.firstName,
          lastName: row.student.lastName,
          overallAverage: row.overallAverage,
          position: row.position,
          subjects: row.subjects.map((sub): StudentSubjectGrade => ({
            subjectId: sub.subjectId,
            subjectName: sub.subjectName,
            courseworkAverage: null,
            examAverage: null,
            termComposite: sub.average,
            yearGrade: null,
          })),
        }));

        const summary: ClassSummary = {
          classAverage: null,
          highestAverage: null,
          lowestAverage: null,
          totalStudents: students.length,
          passCount: 0,
          failCount: 0,
          courseworkWeight: 0,
          examWeight: 0,
          gradingModel: "term_based",
          subjectAverages: [],
          students,
        };

        const blob = await buildEndOfYearExamPdfBlob(summary, {
          className,
          termName: termLabel,
          scoreField: "termComposite",
        });
        downloadBlob(blob, `${className}_${termLabel || "term"}_report.pdf`);
      } else {
        toast.error("No data available to generate report");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to generate report";
      toast.error(msg);
    } finally {
      generatingReport.value = false;
    }
  };

  const fetchData = useCallback(() => {
    Promise.all([
      api<ClassInfo[]>("/classes").then((cls) => cls.find((c) => c.id === classId) ?? null),
      api<EnrolledStudent[]>(`/classes/${classId}/students`).catch(() => []),
      api<TeacherAssignment[]>(`/classes/${classId}/teachers`).catch(() => []),
    ]).then(([info, students, teacherList]) => {
      classInfo.value = info;
      enrolled.value = students;
      teachers.value = teacherList.filter((t) => t.firstName !== null);
      loading.value = false;

      if (info?.academicYearId) {
        api<Term[]>(`/terms?yearId=${info.academicYearId}`)
          .then((t) => {
            const sorted = t.sort((a, b) => a.sort_order - b.sort_order);
            terms.value = sorted;
            if (sorted.length > 0 && !selectedTermId.value) {
              selectedTermId.value = sorted[0].id;
            }
          })
          .catch(() => []);

        api<{ grading_model?: string }>(`/academic-years/${info.academicYearId}`)
          .then((ay) => {
            const model = ay.grading_model ?? "term_based";
            gradingModel.value = model;
            if (model === "term_based") summaryView.value = "term";
          })
          .catch(() => {});
      }
    });
  }, [classId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (summaryView.value !== "term" || !selectedTermId.value || !classId) return;
    summaryLoading.value = true;
    summaryPage.value = 0;

    api<SummaryRow[]>(
      `/calculations/class-summary?termId=${selectedTermId.value}&studentGroupId=${classId}`,
    )
      .then((data) => (summaryData.value = data))
      .catch(() => (summaryData.value = []))
      .finally(() => (summaryLoading.value = false));
  }, [selectedTermId.value, classId, summaryView.value]);

  useEffect(() => {
    if (summaryView.value !== "year" || !classInfo.value?.academicYearId || !classId) return;
    yearLoading.value = true;
    yearPage.value = 0;
    api<YearResultRow[]>(
      `/calculations/class-year?academicYearId=${classInfo.value.academicYearId}&studentGroupId=${classId}`,
    )
      .then((data) => (yearData.value = data))
      .catch(() => (yearData.value = []))
      .finally(() => (yearLoading.value = false));
  }, [summaryView.value, classInfo.value?.academicYearId, classId]);

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

  if (loading.value) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!classInfo.value) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/classes")}>
          <ArrowLeft className="mr-2 size-4" /> Back to Classes
        </Button>
        <div className="text-center py-12 text-muted-foreground">
          Class not found or you don&apos;t have access.
        </div>
      </div>
    );
  }

  const info = classInfo.value;

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={info.name}
        description={
          info.isClassTeacher
            ? "You are the class teacher"
            : "You teach subjects in this class"
        }
        onBack={() => router.push("/dashboard/classes")}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => router.push(`/dashboard/classes/${classId}/grading`)}
            >
              <ClipboardList className="mr-2 size-4" />
              Grading
            </Button>
            {info.isClassTeacher && (
              <>
                <Button
                  variant="outline"
                  onClick={() => router.push(`/dashboard/classes/${classId}/reports`)}
                >
                  <ScrollText className="mr-2 size-4" />
                  Reports
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push(`/dashboard/classes/${classId}/class-report`)}
                >
                  <FileBarChart className="mr-2 size-4" />
                  Class Report
                </Button>
              </>
            )}
            {info.isClassTeacher && (
              <Dialog open={enrollOpen.value} onOpenChange={(v) => (enrollOpen.value = v)}>
                <DialogTrigger render={<Button />}>
                  <UserPlus className="mr-2 size-4" />
                  Enroll Students
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Enroll Students</DialogTitle>
                    <DialogDescription>
                      Select students to enroll in {info.name}
                    </DialogDescription>
                  </DialogHeader>
                  <EnrollForm
                    classId={classId}
                    enrolledIds={enrolled.value.map((e) => e.student.id)}
                    onSuccess={() => {
                      enrollOpen.value = false;
                      fetchData();
                    }}
                  />
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      />

      <Card className="animate-fade-in-up-delay-1">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <GraduationCap className="size-4 text-muted-foreground" />
                <CardTitle>Subject Teachers</CardTitle>
              </div>
              <CardDescription>
                Teachers assigned to subjects in this class
              </CardDescription>
            </div>
            {info.isClassTeacher && (
              <Dialog open={assignTeacherOpen.value} onOpenChange={(v) => (assignTeacherOpen.value = v)}>
                <DialogTrigger render={<Button size="sm" />}>
                  <Plus className="mr-2 size-4" />
                  Assign Teacher
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Assign Teacher to Subjects</DialogTitle>
                    <DialogDescription>
                      Select a teacher and the subjects they will teach in {info.name}
                    </DialogDescription>
                  </DialogHeader>
                  <AssignTeacherForm
                    classId={classId}
                    existingTeacherIds={teachers.value.map((t) => t.teacherId)}
                    onSuccess={() => {
                      assignTeacherOpen.value = false;
                      fetchData();
                    }}
                  />
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {teachers.value.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No teachers assigned yet.
            </div>
          ) : (
            <div className="rounded-md border divide-y">
              {teachers.value.map((t) => (
                <div key={t.teacherId} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {t.firstName} {t.lastName}
                      </span>
                      {t.isClassTeacher && (
                        <Badge className="text-xs">Class Teacher</Badge>
                      )}
                    </div>
                    {t.subjects.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {t.subjects.map((s) => (
                          <Badge key={s.id} variant="secondary" className="text-xs">
                            {s.name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-0.5">No subjects assigned</p>
                    )}
                  </div>
                  {info.isClassTeacher && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => (editingTeacher.value = t)}
                        title="Edit subjects"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      {!t.isClassTeacher && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            if (!confirm(`Remove ${t.firstName} ${t.lastName} from this class?`)) return;
                            try {
                              await api(`/classes/${classId}/teachers/${t.teacherId}`, { method: "DELETE" });
                              toast.success("Teacher removed");
                              fetchData();
                            } catch (err) {
                              const msg = err instanceof ApiError ? err.message : "Failed to remove";
                              toast.error(msg);
                            }
                          }}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="animate-fade-in-up-delay-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Enrolled Students</CardTitle>
              <CardDescription>
                {enrolled.value.length} student{enrolled.value.length !== 1 ? "s" : ""} enrolled
              </CardDescription>
            </div>
            {info.isClassTeacher && enrolled.value.length > 0 && (
              <Dialog open={bulkAssignOpen.value} onOpenChange={(v) => (bulkAssignOpen.value = v)}>
                <DialogTrigger render={<Button size="sm" variant="outline" />}>
                  <ListChecks className="mr-2 size-4" />
                  Bulk Assign Subjects
                </DialogTrigger>
                <DialogContent className="sm:max-w-xl">
                  <DialogHeader>
                    <DialogTitle>Bulk Assign Subjects</DialogTitle>
                    <DialogDescription>
                      Select a subject and assign it to multiple students at once
                    </DialogDescription>
                  </DialogHeader>
                  <BulkAssignSubjects
                    classId={classId}
                    enrolled={enrolled.value}
                    onSuccess={() => {
                      bulkAssignOpen.value = false;
                      fetchData();
                    }}
                  />
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {enrolled.value.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No students enrolled yet. {info.isClassTeacher ? "Click \"Enroll Students\" to add some." : ""}
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
                    {info.isClassTeacher && (
                      <TableHead className="text-right">Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrolled.value.map((e) => (
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
                        {info.isClassTeacher ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => (subjectStudent.value = e)}
                          >
                            <BookOpen className="mr-1 size-3" />
                            Manage
                          </Button>
                        ) : e.subjects?.length ? (
                          <div className="flex flex-wrap gap-1">
                            {e.subjects.map((s) => (
                              <Badge key={s.id} variant="secondary" className="text-xs">
                                {s.code || s.name}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      {info.isClassTeacher && (
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

      {info.isClassTeacher && (
      <Card className="animate-fade-in-up-delay-3">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <BarChart3 className="size-4 text-muted-foreground" />
                <CardTitle>Class Summary</CardTitle>
              </div>
              <CardDescription>
                {summaryView.value === "term" ? "Term results and class rankings" : "Year-end results across all terms"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {gradingModel.value === "year_based" && (
                <div className="flex rounded-md border">
                  <Button
                    variant={summaryView.value === "term" ? "default" : "ghost"}
                    size="sm"
                    className="rounded-r-none"
                    onClick={() => (summaryView.value = "term")}
                  >
                    Term
                  </Button>
                  <Button
                    variant={summaryView.value === "year" ? "default" : "ghost"}
                    size="sm"
                    className="rounded-l-none"
                    onClick={() => (summaryView.value = "year")}
                  >
                    Year
                  </Button>
                </div>
              )}
              {summaryView.value === "term" && (
                <select
                  className={`${selectClass} w-auto min-w-[140px]`}
                  value={selectedTermId.value}
                  onChange={(e) => (selectedTermId.value = e.target.value)}
                >
                  {terms.value.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name.charAt(0).toUpperCase() + t.name.slice(1)}
                    </option>
                  ))}
                </select>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={generatingReport.value || (summaryView.value === "term" ? summaryData.value.length === 0 : yearData.value.length === 0)}
                onClick={generateReport}
              >
                <Download className="mr-2 size-4" />
                {generatingReport.value ? "Generating…" : "Generate Report"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {summaryView.value === "term" ? (
            summaryLoading.value ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : summaryData.value.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No grades recorded for this term yet.
              </div>
            ) : (
              (() => {
                const seen = new Set<string>();
                const subjectCols: { id: string; name: string }[] = [];
                for (const row of summaryData.value) {
                  for (const s of row.subjects) {
                    if (!seen.has(s.subjectId)) {
                      seen.add(s.subjectId);
                      subjectCols.push({ id: s.subjectId, name: s.subjectName });
                    }
                  }
                }

                const total = summaryData.value.length;
                const ps = summaryPageSize.value;
                const pageCount = Math.ceil(total / ps);
                const start = summaryPage.value * ps;
                const pageRows = summaryData.value.slice(start, start + ps);

                return (
                  <div className="space-y-3">
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12 text-center">#</TableHead>
                            <TableHead>Student</TableHead>
                            {subjectCols.map((c) => (
                              <TableHead key={c.id} className="text-center min-w-[80px]">
                                {c.name}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pageRows.map((row) => {
                            const subjectMap = new Map(
                              row.subjects.map((s) => [s.subjectId, s.average]),
                            );

                            return (
                              <TableRow key={row.student.id}>
                                <TableCell className="text-center">
                                  <Badge variant="outline" className="text-xs font-mono">
                                    {row.position}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-medium whitespace-nowrap">
                                  <span className="mr-2">{row.student.firstName} {row.student.lastName}</span>
                                  {row.overallAverage != null && (
                                    <Badge className="font-semibold tabular-nums text-xs">
                                      Overall - {row.overallAverage.toFixed(1)}%
                                    </Badge>
                                  )}
                                </TableCell>
                                {subjectCols.map((c) => {
                                  const avg = subjectMap.get(c.id);
                                  return (
                                    <TableCell key={c.id} className="text-center tabular-nums">
                                      {avg != null ? avg.toFixed(1) : "-"}
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    {total > ps && (
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span>Rows per page</span>
                          <select
                            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                            value={ps}
                            onChange={(e) => { summaryPageSize.value = Number(e.target.value); summaryPage.value = 0; }}
                          >
                            <option value={10}>10</option>
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {start + 1}-{Math.min(start + ps, total)} of {total}
                          </span>
                          <Button variant="outline" size="icon" className="size-8" disabled={summaryPage.value === 0} onClick={() => (summaryPage.value -= 1)}>
                            <ChevronLeft className="size-4" />
                          </Button>
                          <Button variant="outline" size="icon" className="size-8" disabled={summaryPage.value >= pageCount - 1} onClick={() => (summaryPage.value += 1)}>
                            <ChevronRight className="size-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            )
          ) : (
            yearLoading.value ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : yearData.value.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No year data available yet.
              </div>
            ) : (
              (() => {
                const termNames = terms.value.map((t) => ({
                  id: t.id,
                  label: t.name.charAt(0).toUpperCase() + t.name.slice(1),
                  short: t.name.substring(0, 3).toUpperCase(),
                }));

                const seen = new Set<string>();
                const subjectCols: { id: string; name: string }[] = [];
                for (const row of yearData.value) {
                  for (const s of row.yearEnd.subjects) {
                    if (!seen.has(s.subjectId)) {
                      seen.add(s.subjectId);
                      subjectCols.push({ id: s.subjectId, name: s.subjectName });
                    }
                  }
                }

                const total = yearData.value.length;
                const ps = yearPageSize.value;
                const pageCount = Math.ceil(total / ps);
                const start = yearPage.value * ps;
                const pageRows = yearData.value.slice(start, start + ps);

                return (
                  <div className="space-y-3">
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead rowSpan={2} className="w-12 text-center align-bottom">#</TableHead>
                            <TableHead rowSpan={2} className="align-bottom">Student</TableHead>
                            {subjectCols.map((c) => (
                              <TableHead
                                key={c.id}
                                colSpan={termNames.length + 1}
                                className="text-center border-l"
                              >
                                {c.name}
                              </TableHead>
                            ))}
                          </TableRow>
                          <TableRow>
                            {subjectCols.flatMap((c) => [
                              ...termNames.map((t) => (
                                <TableHead key={`${c.id}-${t.id}`} className="text-center text-xs px-2 border-l min-w-[50px]">
                                  {t.short}
                                </TableHead>
                              )),
                              <TableHead key={`${c.id}-year`} className="text-center text-xs font-semibold px-2 min-w-[50px]">
                                YR
                              </TableHead>,
                            ])}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pageRows.map((row) => {
                            const yearSubjectMap = new Map(
                              row.yearEnd.subjects.map((s) => [s.subjectId, s]),
                            );

                            return (
                              <TableRow key={row.studentId}>
                                <TableCell className="text-center">
                                  <Badge variant="outline" className="text-xs font-mono">
                                    {row.position}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-medium whitespace-nowrap">
                                  <span className="mr-2">{row.firstName} {row.lastName}</span>
                                  {row.yearEnd.overallAverage != null && (
                                    <Badge className="font-semibold tabular-nums text-xs">
                                      Overall - {row.yearEnd.overallAverage.toFixed(1)}%
                                    </Badge>
                                  )}
                                </TableCell>
                                {subjectCols.flatMap((c) => {
                                  const yearSubj = yearSubjectMap.get(c.id);
                                  return [
                                    ...termNames.map((t) => {
                                      const termGrade = yearSubj?.termGrades.find(
                                        (tg) => tg.termId === t.id,
                                      );
                                      return (
                                        <TableCell key={`${row.studentId}-${c.id}-${t.id}`} className="text-center tabular-nums text-sm px-2 border-l">
                                          {termGrade?.termComposite != null
                                            ? termGrade.termComposite.toFixed(1)
                                            : "-"}
                                        </TableCell>
                                      );
                                    }),
                                    <TableCell key={`${row.studentId}-${c.id}-year`} className="text-center tabular-nums text-sm font-semibold px-2">
                                      {yearSubj?.yearGrade != null
                                        ? yearSubj.yearGrade.toFixed(1)
                                        : "-"}
                                    </TableCell>,
                                  ];
                                })}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    {total > ps && (
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span>Rows per page</span>
                          <select
                            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                            value={ps}
                            onChange={(e) => { yearPageSize.value = Number(e.target.value); yearPage.value = 0; }}
                          >
                            <option value={10}>10</option>
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {start + 1}-{Math.min(start + ps, total)} of {total}
                          </span>
                          <Button variant="outline" size="icon" className="size-8" disabled={yearPage.value === 0} onClick={() => (yearPage.value -= 1)}>
                            <ChevronLeft className="size-4" />
                          </Button>
                          <Button variant="outline" size="icon" className="size-8" disabled={yearPage.value >= pageCount - 1} onClick={() => (yearPage.value += 1)}>
                            <ChevronRight className="size-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            )
          )}
        </CardContent>
      </Card>
      )}

      <Dialog
        open={editingTeacher.value !== null}
        onOpenChange={(open) => {
          if (!open) editingTeacher.value = null;
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Edit Subjects for {editingTeacher.value?.firstName} {editingTeacher.value?.lastName}
            </DialogTitle>
            <DialogDescription>
              Select the subjects this teacher will teach in {info.name}
            </DialogDescription>
          </DialogHeader>
          {editingTeacher.value && (
            <EditTeacherSubjectsForm
              classId={classId}
              teacher={editingTeacher.value}
              onSuccess={() => {
                editingTeacher.value = null;
                fetchData();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={subjectStudent.value !== null}
        onOpenChange={(open) => {
          if (!open) subjectStudent.value = null;
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Subjects - {subjectStudent.value?.student.first_name} {subjectStudent.value?.student.last_name}
            </DialogTitle>
            <DialogDescription>
              Manage subject assignments for this student
            </DialogDescription>
          </DialogHeader>
          {subjectStudent.value && (
            <ManageSubjects
              classId={classId}
              studentId={subjectStudent.value.student.id}
              studentName={`${subjectStudent.value.student.first_name} ${subjectStudent.value.student.last_name}`}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
