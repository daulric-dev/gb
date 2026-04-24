"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Save, EyeOff, Eye } from "lucide-react";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

interface Term {
  id: string;
  name: string;
  academic_year_id: string;
}

interface Subject {
  id: string;
  name: string;
  code: string;
}

interface Assessment {
  id: string;
  term_id: string;
  subject_id: string;
  title: string;
  assessment_type: "exam" | "coursework";
  assessment_date: string | null;
  max_score: number;
  weight: number;
  sort_order: number;
  is_excluded: boolean;
  exclusion_reason: string | null;
}

interface GradeRow {
  id: string;
  assessment_id: string;
  student_id: string;
  score: number | null;
  letter_grade: string | null;
  remarks: string | null;
  is_excluded: boolean;
  exclusion_reason: string | null;
  student: { id: string; first_name: string; last_name: string } | null;
}

interface AcademicYear {
  id: string;
  name: string;
  is_active: boolean;
}

interface ClassInfo {
  id: string;
  name: string;
  academicYearId: string;
  isClassTeacher: boolean;
}

export default function GradingPage() {
  useSignals();
  const params = useParams();
  const router = useRouter();
  const classId = params?.classId as string;

  const classInfo = useSignal<ClassInfo | null>(null);
  const terms = useSignal<Term[]>([]);
  const subjects = useSignal<Subject[]>([]);
  const selectedTermId = useSignal("");
  const selectedSubjectId = useSignal("");
  const assessments = useSignal<Assessment[]>([]);
  const selectedAssessment = useSignal<Assessment | null>(null);
  const grades = useSignal<GradeRow[]>([]);
  const loading = useSignal(true);
  const assessmentsLoading = useSignal(false);
  const gradesLoading = useSignal(false);
  const createOpen = useSignal(false);
  const editAssessment = useSignal<Assessment | null>(null);

  useEffect(() => {
    Promise.all([
      api<ClassInfo[]>("/classes").then(
        (cls) => cls.find((c) => c.id === classId) ?? null,
      ),
      api<Subject[]>(`/classes/${classId}/my-subjects`).catch(() => []),
      api<AcademicYear[]>("/academic-years").catch(() => []),
    ]).then(([info, subs]) => {
      classInfo.value = info;
      subjects.value = subs;
      if (info?.academicYearId) {
        api<Term[]>(`/terms?yearId=${info.academicYearId}`)
          .then((t) => {
            terms.value = t;
            if (t.length > 0) selectedTermId.value = t[0].id;
          })
          .catch(() => {});
      }
      if (subs.length > 0) selectedSubjectId.value = subs[0].id;
      loading.value = false;
    });
  }, [classId]);

  const fetchAssessments = useCallback(() => {
    if (!selectedTermId.value || !selectedSubjectId.value) return;
    assessmentsLoading.value = true;
    api<Assessment[]>(
      `/assessments?termId=${selectedTermId.value}&subjectId=${selectedSubjectId.value}`,
    )
      .then((data) => {
        assessments.value = data;
        if (data.length > 0 && !selectedAssessment.value) {
          selectedAssessment.value = data[0];
        } else if (data.length > 0 && selectedAssessment.value) {
          const still = data.find((a) => a.id === selectedAssessment.value!.id);
          selectedAssessment.value = still ?? data[0];
        } else {
          selectedAssessment.value = null;
        }
      })
      .catch(() => toast.error("Failed to load assessments"))
      .finally(() => (assessmentsLoading.value = false));
  }, [selectedTermId.value, selectedSubjectId.value]);

  useEffect(() => {
    fetchAssessments();
  }, [fetchAssessments]);

  const fetchGrades = useCallback(() => {
    if (!selectedAssessment.value) {
      grades.value = [];
      return;
    }
    gradesLoading.value = true;
    api<GradeRow[]>(`/grades?assessmentId=${selectedAssessment.value.id}`)
      .then((data) => (grades.value = data))
      .catch(() => toast.error("Failed to load grades"))
      .finally(() => (gradesLoading.value = false));
  }, [selectedAssessment.value]);

  useEffect(() => {
    fetchGrades();
  }, [fetchGrades]);

  async function handleDeleteAssessment(a: Assessment) {
    if (
      !confirm(
        `Delete "${a.title}"? All grades for this assessment will be removed.`,
      )
    )
      return;
    try {
      await api(`/assessments/${a.id}`, { method: "DELETE" });
      toast.success("Assessment deleted");
      selectedAssessment.value = null;
      fetchAssessments();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Failed to delete";
      toast.error(msg);
    }
  }

  async function handleToggleExcludeAssessment(a: Assessment) {
    try {
      const updated = await api<Assessment>(
        `/assessments/${a.id}/exclude`,
        {
          method: "PATCH",
          body: {
            isExcluded: !a.is_excluded,
            exclusionReason: !a.is_excluded ? "Excluded by teacher" : undefined,
          },
        },
      );
      toast.success(
        updated.is_excluded ? "Assessment excluded" : "Assessment included",
      );
      fetchAssessments();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Failed to update";
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

  const termLabel: Record<string, string> = {
    michaelmas: "Michaelmas",
    hilary: "Hilary",
    trinity: "Trinity",
  };

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title="Grading"
        description={`${classInfo.value?.name ?? ""} - Enter and Manage Grades`}
        onBack={() => router.push(`/dashboard/classes/${classId}`)}
      />

      <div className="grid grid-cols-2 gap-4 animate-fade-in-up-delay-1">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Term</Label>
          <select
            className={selectClass}
            value={selectedTermId.value}
            onChange={(e) => {
              selectedTermId.value = e.target.value;
              selectedAssessment.value = null;
            }}
          >
            {terms.value.map((t) => (
              <option key={t.id} value={t.id}>
                {termLabel[t.name] ?? t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Subject</Label>
          <select
            className={selectClass}
            value={selectedSubjectId.value}
            onChange={(e) => {
              selectedSubjectId.value = e.target.value;
              selectedAssessment.value = null;
            }}
          >
            {subjects.value.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.code ? `(${s.code})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Card className="animate-fade-in-up-delay-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Assessments</CardTitle>
              <CardDescription>
                {assessments.value.length} assessment
                {assessments.value.length !== 1 ? "s" : ""}
              </CardDescription>
            </div>
            <Dialog open={createOpen.value} onOpenChange={(v) => (createOpen.value = v)}>
              <DialogTrigger
                render={
                  <Button
                    size="sm"
                    disabled={!selectedTermId.value || !selectedSubjectId.value}
                  />
                }
              >
                <Plus className="mr-2 size-4" />
                New Assessment
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Assessment</DialogTitle>
                  <DialogDescription>
                    Add an exam or coursework assessment
                  </DialogDescription>
                </DialogHeader>
                <CreateAssessmentForm
                  termId={selectedTermId.value}
                  subjectId={selectedSubjectId.value}
                  onSuccess={() => {
                    createOpen.value = false;
                    fetchAssessments();
                  }}
                />
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {assessmentsLoading.value ? (
            <Skeleton className="h-24 w-full" />
          ) : assessments.value.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No assessments yet. Create one to start entering grades.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {assessments.value.map((a) => (
                <button
                  key={a.id}
                  onClick={() => (selectedAssessment.value = a)}
                  className={`group relative rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selectedAssessment.value?.id === a.id
                      ? "border-primary bg-accent"
                      : "hover:bg-accent/50"
                  } ${a.is_excluded ? "opacity-50" : ""}`}
                >
                  <div className="font-medium">{a.title}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge
                      variant="outline"
                      className="text-xs capitalize"
                    >
                      {a.assessment_type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      /{a.max_score}
                    </span>
                    {a.is_excluded && (
                      <Badge variant="secondary" className="text-xs">
                        Excluded
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedAssessment.value && (
        <Card className="animate-fade-in-up">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{selectedAssessment.value.title}</CardTitle>
                <CardDescription>
                  <Badge
                    variant="outline"
                    className="capitalize mr-2"
                  >
                    {selectedAssessment.value.assessment_type}
                  </Badge>
                  Max score: {selectedAssessment.value.max_score} - Weight:{" "}
                  {selectedAssessment.value.weight}
                </CardDescription>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    handleToggleExcludeAssessment(selectedAssessment.value!)
                  }
                  title={
                    selectedAssessment.value.is_excluded
                      ? "Include in calculations"
                      : "Exclude from calculations"
                  }
                >
                  {selectedAssessment.value.is_excluded ? (
                    <Eye className="size-4" />
                  ) : (
                    <EyeOff className="size-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => (editAssessment.value = selectedAssessment.value)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    handleDeleteAssessment(selectedAssessment.value!)
                  }
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {gradesLoading.value ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <GradeEntryTable
                assessmentId={selectedAssessment.value.id}
                maxScore={selectedAssessment.value.max_score}
                existingGrades={grades.value}
                classId={classId}
                subjectId={selectedSubjectId.value}
                onSaved={fetchGrades}
              />
            )}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={editAssessment.value !== null}
        onOpenChange={(open) => {
          if (!open) editAssessment.value = null;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Assessment</DialogTitle>
            <DialogDescription>Update assessment details</DialogDescription>
          </DialogHeader>
          {editAssessment.value && (
            <EditAssessmentForm
              assessment={editAssessment.value}
              onSuccess={() => {
                editAssessment.value = null;
                fetchAssessments();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GradeEntryTable({
  assessmentId,
  maxScore,
  existingGrades,
  classId,
  subjectId,
  onSaved,
}: {
  assessmentId: string;
  maxScore: number;
  existingGrades: GradeRow[];
  classId: string;
  subjectId: string;
  onSaved: () => void;
}) {
  useSignals();
  const enrolled = useSignal<
    { id: string; student: { id: string; first_name: string; last_name: string } }[]
  >([]);
  const scores = useSignal<
    Map<string, { score: string; remarks: string }>
  >(new Map());
  const saving = useSignal(false);
  const excluding = useSignal<string | null>(null);
  const loadingStudents = useSignal(true);

  useEffect(() => {
    if (!subjectId) return;
    loadingStudents.value = true;
    api<{ id: string; student: { id: string; first_name: string; last_name: string } }[]>(
      `/classes/${classId}/students?subjectId=${subjectId}`,
    )
      .then((data) => (enrolled.value = data))
      .catch(() => {})
      .finally(() => (loadingStudents.value = false));
  }, [classId, subjectId]);

  useEffect(() => {
    const map = new Map<string, { score: string; remarks: string }>();
    for (const g of existingGrades) {
      map.set(g.student_id, {
        score: g.score !== null ? String(g.score) : "",
        remarks: g.remarks ?? "",
      });
    }
    scores.value = map;
  }, [existingGrades]);

  function updateScore(studentId: string, field: "score" | "remarks", value: string) {
    const next = new Map(scores.value);
    const existing = next.get(studentId) ?? { score: "", remarks: "" };
    next.set(studentId, { ...existing, [field]: value });
    scores.value = next;
  }

  async function handleSave() {
    const gradeEntries: { studentId: string; score: number; remarks?: string }[] = [];

    for (const e of enrolled.value) {
      const entry = scores.value.get(e.student.id);
      if (entry?.score !== undefined && entry.score !== "") {
        let numScore = Number(entry.score);
        if (isNaN(numScore)) continue;
        if (numScore < 0) numScore = 0;
        if (numScore > maxScore) numScore = maxScore;
        gradeEntries.push({
          studentId: e.student.id,
          score: numScore,
          remarks: entry.remarks || undefined,
        });
      }
    }

    if (gradeEntries.length === 0) {
      toast.error("No scores to save");
      return;
    }

    saving.value = true;
    try {
      await api("/grades/bulk", {
        method: "POST",
        body: { assessmentId, grades: gradeEntries },
      });
      toast.success(`${gradeEntries.length} grade${gradeEntries.length > 1 ? "s" : ""} saved`);
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to save";
      toast.error(msg);
    } finally {
      saving.value = false;
    }
  }

  async function handleToggleExclude(grade: GradeRow) {
    excluding.value = grade.id;
    try {
      await api(`/grades/${grade.id}/exclude`, {
        method: "PATCH",
        body: {
          isExcluded: !grade.is_excluded,
          exclusionReason: !grade.is_excluded ? "Excluded by teacher" : undefined,
        },
      });
      toast.success(
        grade.is_excluded ? "Grade included" : "Grade excluded",
      );
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to update";
      toast.error(msg);
    } finally {
      excluding.value = null;
    }
  }

  if (loadingStudents.value) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (enrolled.value.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No students enrolled in this class.
      </div>
    );
  }

  const sortedStudents = [...enrolled.value].sort((a, b) =>
    a.student.last_name.localeCompare(b.student.last_name),
  );

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead className="w-28">
                Score (/{maxScore})
              </TableHead>
              <TableHead>Remarks</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedStudents.map((e) => {
              const entry = scores.value.get(e.student.id) ?? {
                score: "",
                remarks: "",
              };
              const existingGrade = existingGrades.find(
                (g) => g.student_id === e.student.id,
              );
              return (
                <TableRow
                  key={e.student.id}
                  className={
                    existingGrade?.is_excluded ? "opacity-50" : ""
                  }
                >
                  <TableCell className="font-medium">
                    {e.student.first_name} {e.student.last_name}
                    {existingGrade?.is_excluded && (
                      <Badge
                        variant="secondary"
                        className="ml-2 text-xs"
                      >
                        Excluded
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      max={maxScore}
                      step="any"
                      value={entry.score}
                      onChange={(ev) =>
                        updateScore(
                          e.student.id,
                          "score",
                          ev.target.value,
                        )
                      }
                      className="w-24 h-8 text-sm"
                      placeholder="-"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={entry.remarks}
                      onChange={(ev) =>
                        updateScore(
                          e.student.id,
                          "remarks",
                          ev.target.value,
                        )
                      }
                      className="h-8 text-sm"
                      placeholder="Optional remarks"
                    />
                  </TableCell>
                  <TableCell>
                    {existingGrade && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={excluding.value === existingGrade.id}
                        onClick={() => handleToggleExclude(existingGrade)}
                        title={
                          existingGrade.is_excluded
                            ? "Include in calculations"
                            : "Exclude from calculations"
                        }
                      >
                        {existingGrade.is_excluded ? (
                          <Eye className="size-4" />
                        ) : (
                          <EyeOff className="size-4 text-muted-foreground" />
                        )}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Button onClick={handleSave} disabled={saving.value} className="w-full">
        <Save className="mr-2 size-4" />
        {saving.value ? "Saving..." : "Save All Grades"}
      </Button>
    </div>
  );
}

function CreateAssessmentForm({
  termId,
  subjectId,
  onSuccess,
}: {
  termId: string;
  subjectId: string;
  onSuccess: () => void;
}) {
  useSignals();
  const title = useSignal("");
  const assessmentType = useSignal<"exam" | "coursework">("exam");
  const maxScore = useSignal(100);
  const weight = useSignal(1);
  const assessmentDate = useSignal("");
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    const body: Record<string, unknown> = {
      termId,
      subjectId,
      title: title.value,
      assessmentType: assessmentType.value,
      maxScore: maxScore.value,
      weight: weight.value,
    };
    if (assessmentDate.value) body.assessmentDate = assessmentDate.value;

    try {
      await api("/assessments", { method: "POST", body });
      toast.success("Assessment created");
      onSuccess();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Failed to create";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          placeholder="Mid-term Exam"
          value={title.value}
          onChange={(e) => (title.value = e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="type">Type</Label>
        <select
          id="type"
          className={selectClass}
          value={assessmentType.value}
          onChange={(e) =>
            (assessmentType.value = e.target.value as "exam" | "coursework")
          }
        >
          <option value="exam">Exam</option>
          <option value="coursework">Coursework</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="maxScore">Max Score</Label>
          <Input
            id="maxScore"
            type="number"
            min={1}
            max={1000}
            value={maxScore.value}
            onChange={(e) => (maxScore.value = Number(e.target.value))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="weight">Weight</Label>
          <Input
            id="weight"
            type="number"
            min={0}
            step="any"
            value={weight.value}
            onChange={(e) => (weight.value = Number(e.target.value))}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="date">Date (optional)</Label>
        <Input
          id="date"
          type="date"
          value={assessmentDate.value}
          onChange={(e) => (assessmentDate.value = e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Creating..." : "Create Assessment"}
      </Button>
    </form>
  );
}

function EditAssessmentForm({
  assessment,
  onSuccess,
}: {
  assessment: Assessment;
  onSuccess: () => void;
}) {
  useSignals();
  const title = useSignal(assessment.title);
  const maxScore = useSignal(assessment.max_score);
  const weight = useSignal(assessment.weight);
  const assessmentDate = useSignal(assessment.assessment_date ?? "");
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    try {
      await api(`/assessments/${assessment.id}`, {
        method: "PATCH",
        body: {
          title: title.value,
          maxScore: maxScore.value,
          weight: weight.value,
          assessmentDate: assessmentDate.value || undefined,
        },
      });
      toast.success("Assessment updated");
      onSuccess();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Failed to update";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="editTitle">Title</Label>
        <Input
          id="editTitle"
          value={title.value}
          onChange={(e) => (title.value = e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label>Type</Label>
        <p className="text-sm font-medium capitalize">
          {assessment.assessment_type}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editMaxScore">Max Score</Label>
          <Input
            id="editMaxScore"
            type="number"
            min={1}
            max={1000}
            value={maxScore.value}
            onChange={(e) => (maxScore.value = Number(e.target.value))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editWeight">Weight</Label>
          <Input
            id="editWeight"
            type="number"
            min={0}
            step="any"
            value={weight.value}
            onChange={(e) => (weight.value = Number(e.target.value))}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="editDate">Date</Label>
        <Input
          id="editDate"
          type="date"
          value={assessmentDate.value}
          onChange={(e) => (assessmentDate.value = e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
