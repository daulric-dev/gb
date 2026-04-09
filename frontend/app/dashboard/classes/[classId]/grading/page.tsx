"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Plus, Pencil, Trash2, Save, EyeOff, Eye } from "lucide-react";

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
  const params = useParams();
  const router = useRouter();
  const classId = params.classId as string;

  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedTermId, setSelectedTermId] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selectedAssessment, setSelectedAssessment] =
    useState<Assessment | null>(null);
  const [grades, setGrades] = useState<GradeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [assessmentsLoading, setAssessmentsLoading] = useState(false);
  const [gradesLoading, setGradesLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editAssessment, setEditAssessment] = useState<Assessment | null>(null);

  useEffect(() => {
    Promise.all([
      api<ClassInfo[]>("/classes").then(
        (cls) => cls.find((c) => c.id === classId) ?? null,
      ),
      api<Subject[]>("/subjects").catch(() => []),
      api<AcademicYear[]>("/academic-years").catch(() => []),
    ]).then(([info, subs, years]) => {
      setClassInfo(info);
      setSubjects(subs);
      if (info?.academicYearId) {
        api<Term[]>(`/terms?yearId=${info.academicYearId}`)
          .then((t) => {
            setTerms(t);
            if (t.length > 0) setSelectedTermId(t[0].id);
          })
          .catch(() => {});
      }
      if (subs.length > 0) setSelectedSubjectId(subs[0].id);
      setLoading(false);
    });
  }, [classId]);

  const fetchAssessments = useCallback(() => {
    if (!selectedTermId || !selectedSubjectId) return;
    setAssessmentsLoading(true);
    api<Assessment[]>(
      `/assessments?termId=${selectedTermId}&subjectId=${selectedSubjectId}`,
    )
      .then((data) => {
        setAssessments(data);
        if (data.length > 0 && !selectedAssessment) {
          setSelectedAssessment(data[0]);
        } else if (data.length > 0 && selectedAssessment) {
          const still = data.find((a) => a.id === selectedAssessment.id);
          setSelectedAssessment(still ?? data[0]);
        } else {
          setSelectedAssessment(null);
        }
      })
      .catch(() => toast.error("Failed to load assessments"))
      .finally(() => setAssessmentsLoading(false));
  }, [selectedTermId, selectedSubjectId]);

  useEffect(() => {
    fetchAssessments();
  }, [fetchAssessments]);

  const fetchGrades = useCallback(() => {
    if (!selectedAssessment) {
      setGrades([]);
      return;
    }
    setGradesLoading(true);
    api<GradeRow[]>(`/grades?assessmentId=${selectedAssessment.id}`)
      .then(setGrades)
      .catch(() => toast.error("Failed to load grades"))
      .finally(() => setGradesLoading(false));
  }, [selectedAssessment]);

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
      setSelectedAssessment(null);
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

  if (loading) {
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
      <div className="flex items-center justify-between animate-fade-in-up">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push(`/dashboard/classes/${classId}`)}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">grading</h1>
            <p className="text-muted-foreground mt-1">
              {classInfo?.name} - enter and manage grades
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 animate-fade-in-up-delay-1">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Term</Label>
          <select
            className={selectClass}
            value={selectedTermId}
            onChange={(e) => {
              setSelectedTermId(e.target.value);
              setSelectedAssessment(null);
            }}
          >
            {terms.map((t) => (
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
            value={selectedSubjectId}
            onChange={(e) => {
              setSelectedSubjectId(e.target.value);
              setSelectedAssessment(null);
            }}
          >
            {subjects.map((s) => (
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
                {assessments.length} assessment
                {assessments.length !== 1 ? "s" : ""}
              </CardDescription>
            </div>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger
                render={
                  <Button
                    size="sm"
                    disabled={!selectedTermId || !selectedSubjectId}
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
                  termId={selectedTermId}
                  subjectId={selectedSubjectId}
                  onSuccess={() => {
                    setCreateOpen(false);
                    fetchAssessments();
                  }}
                />
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {assessmentsLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : assessments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No assessments yet. Create one to start entering grades.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {assessments.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedAssessment(a)}
                  className={`group relative rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selectedAssessment?.id === a.id
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

      {selectedAssessment && (
        <Card className="animate-fade-in-up">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{selectedAssessment.title}</CardTitle>
                <CardDescription>
                  <Badge
                    variant="outline"
                    className="capitalize mr-2"
                  >
                    {selectedAssessment.assessment_type}
                  </Badge>
                  Max score: {selectedAssessment.max_score} - Weight:{" "}
                  {selectedAssessment.weight}
                </CardDescription>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    handleToggleExcludeAssessment(selectedAssessment)
                  }
                  title={
                    selectedAssessment.is_excluded
                      ? "Include in calculations"
                      : "Exclude from calculations"
                  }
                >
                  {selectedAssessment.is_excluded ? (
                    <Eye className="size-4" />
                  ) : (
                    <EyeOff className="size-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditAssessment(selectedAssessment)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    handleDeleteAssessment(selectedAssessment)
                  }
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {gradesLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <GradeEntryTable
                assessmentId={selectedAssessment.id}
                maxScore={selectedAssessment.max_score}
                existingGrades={grades}
                classId={classId}
                onSaved={fetchGrades}
              />
            )}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={editAssessment !== null}
        onOpenChange={(open) => {
          if (!open) setEditAssessment(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Assessment</DialogTitle>
            <DialogDescription>Update assessment details</DialogDescription>
          </DialogHeader>
          {editAssessment && (
            <EditAssessmentForm
              assessment={editAssessment}
              onSuccess={() => {
                setEditAssessment(null);
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
  onSaved,
}: {
  assessmentId: string;
  maxScore: number;
  existingGrades: GradeRow[];
  classId: string;
  onSaved: () => void;
}) {
  const [enrolled, setEnrolled] = useState<
    { id: string; student: { id: string; first_name: string; last_name: string } }[]
  >([]);
  const [scores, setScores] = useState<
    Map<string, { score: string; remarks: string }>
  >(new Map());
  const [saving, setSaving] = useState(false);
  const [excluding, setExcluding] = useState<string | null>(null);
  const [loadingStudents, setLoadingStudents] = useState(true);

  useEffect(() => {
    api<{ id: string; student: { id: string; first_name: string; last_name: string } }[]>(
      `/classes/${classId}/students`,
    )
      .then(setEnrolled)
      .catch(() => {})
      .finally(() => setLoadingStudents(false));
  }, [classId]);

  useEffect(() => {
    const map = new Map<string, { score: string; remarks: string }>();
    for (const g of existingGrades) {
      map.set(g.student_id, {
        score: g.score !== null ? String(g.score) : "",
        remarks: g.remarks ?? "",
      });
    }
    setScores(map);
  }, [existingGrades]);

  function updateScore(studentId: string, field: "score" | "remarks", value: string) {
    setScores((prev) => {
      const next = new Map(prev);
      const existing = next.get(studentId) ?? { score: "", remarks: "" };
      next.set(studentId, { ...existing, [field]: value });
      return next;
    });
  }

  async function handleSave() {
    const gradeEntries: { studentId: string; score: number; remarks?: string }[] = [];

    for (const e of enrolled) {
      const entry = scores.get(e.student.id);
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

    setSaving(true);
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
      setSaving(false);
    }
  }

  async function handleToggleExclude(grade: GradeRow) {
    setExcluding(grade.id);
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
      setExcluding(null);
    }
  }

  if (loadingStudents) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (enrolled.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No students enrolled in this class.
      </div>
    );
  }

  const sortedStudents = [...enrolled].sort((a, b) =>
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
              const entry = scores.get(e.student.id) ?? {
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
                        disabled={excluding === existingGrade.id}
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
      <Button onClick={handleSave} disabled={saving} className="w-full">
        <Save className="mr-2 size-4" />
        {saving ? "Saving..." : "Save All Grades"}
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
  const [title, setTitle] = useState("");
  const [assessmentType, setAssessmentType] = useState<"exam" | "coursework">(
    "exam",
  );
  const [maxScore, setMaxScore] = useState(100);
  const [weight, setWeight] = useState(1);
  const [assessmentDate, setAssessmentDate] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const body: Record<string, unknown> = {
      termId,
      subjectId,
      title,
      assessmentType,
      maxScore,
      weight,
    };
    if (assessmentDate) body.assessmentDate = assessmentDate;

    try {
      await api("/assessments", { method: "POST", body });
      toast.success("Assessment created");
      onSuccess();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Failed to create";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          placeholder="Mid-term Exam"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="type">Type</Label>
        <select
          id="type"
          className={selectClass}
          value={assessmentType}
          onChange={(e) =>
            setAssessmentType(e.target.value as "exam" | "coursework")
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
            value={maxScore}
            onChange={(e) => setMaxScore(Number(e.target.value))}
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
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="date">Date (optional)</Label>
        <Input
          id="date"
          type="date"
          value={assessmentDate}
          onChange={(e) => setAssessmentDate(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Creating..." : "Create Assessment"}
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
  const [title, setTitle] = useState(assessment.title);
  const [maxScore, setMaxScore] = useState(assessment.max_score);
  const [weight, setWeight] = useState(assessment.weight);
  const [assessmentDate, setAssessmentDate] = useState(
    assessment.assessment_date ?? "",
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      await api(`/assessments/${assessment.id}`, {
        method: "PATCH",
        body: {
          title,
          maxScore,
          weight,
          assessmentDate: assessmentDate || undefined,
        },
      });
      toast.success("Assessment updated");
      onSuccess();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Failed to update";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="editTitle">Title</Label>
        <Input
          id="editTitle"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
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
            value={maxScore}
            onChange={(e) => setMaxScore(Number(e.target.value))}
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
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="editDate">Date</Label>
        <Input
          id="editDate"
          type="date"
          value={assessmentDate}
          onChange={(e) => setAssessmentDate(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
