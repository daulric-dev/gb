"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Eye, EyeOff } from "lucide-react";
import type { Term, Subject, Assessment, GradeRow, AcademicYear, ClassInfo } from "./_components/types";
import { GradeEntryTable } from "./_components/GradeEntryTable";
import { CreateAssessmentForm } from "./_components/CreateAssessmentForm";
import { EditAssessmentForm } from "./_components/EditAssessmentForm";

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
          <Select
            value={selectedTermId.value}
            onValueChange={(v) => {
              selectedTermId.value = v as string;
              selectedAssessment.value = null;
            }}
            items={terms.value.map((t) => ({
              value: t.id,
              label: termLabel[t.name] ?? t.name,
            }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {terms.value.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {termLabel[t.name] ?? t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Subject</Label>
          <Select
            value={selectedSubjectId.value}
            onValueChange={(v) => {
              selectedSubjectId.value = v as string;
              selectedAssessment.value = null;
            }}
            items={subjects.value.map((s) => ({
              value: s.id,
              label: s.code ? `${s.name} (${s.code})` : s.name,
            }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {subjects.value.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.code ? `${s.name} (${s.code})` : s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
