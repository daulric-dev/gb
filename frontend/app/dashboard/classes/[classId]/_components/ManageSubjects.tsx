"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, X } from "lucide-react";
import { AddSubjectsForm } from "./AddSubjectsForm";
import type { Subject } from "./types";

interface StudentSubject {
  id: number;
  subject: Subject | null;
}

export function ManageSubjects({
  classId,
  studentId,
  studentName,
}: {
  classId: string;
  studentId: string;
  studentName: string;
}) {
  useSignals();
  const assigned = useSignal<StudentSubject[]>([]);
  const allSubjects = useSignal<Subject[]>([]);
  const loading = useSignal(true);
  const addOpen = useSignal(false);

  const fetchSubjects = useCallback(() => {
    Promise.all([
      api<StudentSubject[]>(`/classes/${classId}/students/${studentId}/subjects`).catch(() => []),
      api<Subject[]>("/subjects").catch(() => []),
    ]).then(([studentSubjects, subjects]) => {
      assigned.value = studentSubjects;
      allSubjects.value = subjects;
      loading.value = false;
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

  if (loading.value) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const assignedSubjectIds = new Set(
    assigned.value.map((a) => a.subject?.id).filter(Boolean),
  );
  const availableSubjects = allSubjects.value.filter(
    (s) => !assignedSubjectIds.has(s.id),
  );

  return (
    <div className="space-y-4">
      {assigned.value.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No subjects assigned yet
        </div>
      ) : (
        <div className="rounded-md border divide-y">
          {assigned.value.map((a) =>
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

      {addOpen.value ? (
        <AddSubjectsForm
          classId={classId}
          studentId={studentId}
          available={availableSubjects}
          onSuccess={() => {
            addOpen.value = false;
            fetchSubjects();
          }}
          onCancel={() => (addOpen.value = false)}
        />
      ) : (
        <Button
          variant="outline"
          className="w-full"
          disabled={availableSubjects.length === 0}
          onClick={() => (addOpen.value = true)}
        >
          <Plus className="mr-2 size-4" />
          {availableSubjects.length === 0 ? "All subjects assigned" : "Add Subjects"}
        </Button>
      )}
    </div>
  );
}
