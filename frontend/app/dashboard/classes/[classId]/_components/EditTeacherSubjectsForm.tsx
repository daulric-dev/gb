"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Subject, TeacherAssignment } from "./types";

export function EditTeacherSubjectsForm({
  classId,
  teacher,
  onSuccess,
}: {
  classId: string;
  teacher: TeacherAssignment;
  onSuccess: () => void;
}) {
  useSignals();
  const allSubjects = useSignal<Subject[]>([]);
  const selectedSubjects = useSignal<Set<string>>(
    new Set(teacher.subjects.map((s) => s.id)),
  );
  const loading = useSignal(true);
  const submitting = useSignal(false);

  useEffect(() => {
    api<Subject[]>("/subjects")
      .then((data) => (allSubjects.value = data))
      .catch(() => [])
      .finally(() => (loading.value = false));
  }, []);

  function toggleSubject(id: string) {
    const next = new Set(selectedSubjects.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedSubjects.value = next;
  }

  async function handleSubmit() {
    submitting.value = true;
    try {
      await api(`/classes/${classId}/teachers`, {
        method: "POST",
        body: {
          teacherId: teacher.teacherId,
          subjectIds: [...selectedSubjects.value],
        },
      });
      toast.success("Subjects updated");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to update";
      toast.error(msg);
    } finally {
      submitting.value = false;
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

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Subjects</label>
        <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
          {allSubjects.value.map((s) => (
            <label
              key={s.id}
              className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors"
            >
              <input
                type="checkbox"
                checked={selectedSubjects.value.has(s.id)}
                onChange={() => toggleSubject(s.id)}
                className="size-4 rounded border-input"
              />
              <span className="text-sm">{s.name}</span>
              {s.code && (
                <Badge variant="secondary" className="text-xs ml-auto">
                  {s.code}
                </Badge>
              )}
            </label>
          ))}
        </div>
      </div>

      <Button
        className="w-full"
        disabled={submitting.value}
        onClick={handleSubmit}
      >
        {submitting.value ? "Saving..." : "Save Subjects"}
      </Button>
    </div>
  );
}
