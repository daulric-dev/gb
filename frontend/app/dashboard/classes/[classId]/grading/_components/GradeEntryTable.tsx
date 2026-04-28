"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Save, EyeOff, Eye } from "lucide-react";
import type { GradeRow } from "./types";

export function GradeEntryTable({
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
