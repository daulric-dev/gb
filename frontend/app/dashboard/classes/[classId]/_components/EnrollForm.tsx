"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface Student {
  id: string;
  first_name: string;
  last_name: string;
  gender: string;
  is_active: boolean;
}

export function EnrollForm({
  classId,
  enrolledIds,
  onSuccess,
}: {
  classId: string;
  enrolledIds: string[];
  onSuccess: () => void;
}) {
  useSignals();
  const allStudents = useSignal<Student[]>([]);
  const selected = useSignal<Set<string>>(new Set());
  const loading = useSignal(true);
  const submitting = useSignal(false);

  useEffect(() => {
    api<Student[]>("/students")
      .then((students) => {
        allStudents.value = students.filter((s) => s.is_active);
      })
      .catch(() => toast.error("Failed to load students"))
      .finally(() => (loading.value = false));
  }, []);

  const available = allStudents.value.filter((s) => !enrolledIds.includes(s.id));

  function toggleStudent(id: string) {
    const next = new Set(selected.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected.value = next;
  }

  const allSelected =
    available.length > 0 && available.every((s) => selected.value.has(s.id));

  function toggleAll() {
    selected.value = allSelected
      ? new Set()
      : new Set(available.map((s) => s.id));
  }

  async function handleEnroll() {
    if (selected.value.size === 0) return;
    submitting.value = true;

    try {
      if (selected.value.size === 1) {
        const [studentId] = selected.value;
        await api(`/classes/${classId}/enroll`, {
          method: "POST",
          body: { studentId },
        });
      } else {
        await api(`/classes/${classId}/enroll/bulk`, {
          method: "POST",
          body: { studentIds: [...selected.value] },
        });
      }
      toast.success(`${selected.value.size} student${selected.value.size > 1 ? "s" : ""} enrolled`);
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to enroll";
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

  if (available.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground">
        All students are already enrolled in this class.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3 px-1 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          className="size-4 rounded border-input"
        />
        <span className="text-sm font-medium">Select all</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {selected.value.size} of {available.length} selected
        </span>
      </label>
      <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
        {available.map((s) => (
          <label
            key={s.id}
            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors"
          >
            <input
              type="checkbox"
              checked={selected.value.has(s.id)}
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
        disabled={selected.value.size === 0 || submitting.value}
        onClick={handleEnroll}
      >
        {submitting.value
          ? "Enrolling..."
          : `Enroll ${selected.value.size} Student${selected.value.size !== 1 ? "s" : ""}`}
      </Button>
    </div>
  );
}
