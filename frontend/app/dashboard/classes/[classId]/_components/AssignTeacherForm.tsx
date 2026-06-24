"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Subject } from "./types";

interface SchoolTeacher {
  id: string;
  first_name: string;
  last_name: string;
}

export function AssignTeacherForm({
  classId,
  existingTeacherIds,
  onSuccess,
}: {
  classId: string;
  existingTeacherIds: string[];
  onSuccess: () => void;
}) {
  useSignals();
  const schoolTeachers = useSignal<SchoolTeacher[]>([]);
  const allSubjects = useSignal<Subject[]>([]);
  const selectedTeacher = useSignal("");
  const selectedSubjects = useSignal<Set<string>>(new Set());
  const loading = useSignal(true);
  const submitting = useSignal(false);

  useEffect(() => {
    Promise.all([
      api<SchoolTeacher[]>("/classes/school-teachers").catch(() => []),
      api<Subject[]>("/subjects").catch(() => []),
    ]).then(([teachers, subjects]) => {
      schoolTeachers.value = teachers.filter((t) => !existingTeacherIds.includes(t.id));
      allSubjects.value = subjects;
      loading.value = false;
    });
  }, [existingTeacherIds]);

  function toggleSubject(id: string) {
    const next = new Set(selectedSubjects.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedSubjects.value = next;
  }

  async function handleSubmit() {
    if (!selectedTeacher.value || selectedSubjects.value.size === 0) return;
    submitting.value = true;

    try {
      await api(`/classes/${classId}/teachers`, {
        method: "POST",
        body: {
          teacherId: selectedTeacher.value,
          subjectIds: [...selectedSubjects.value],
        },
      });
      toast.success("Teacher assigned");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to assign";
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

  if (schoolTeachers.value.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground">
        No available teachers to assign.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Teacher</label>
        <Select
          value={selectedTeacher.value}
          onValueChange={(v) => (selectedTeacher.value = v as string)}
          items={schoolTeachers.value.map((t) => ({
            value: t.id,
            label: `${t.first_name} ${t.last_name}`,
          }))}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a teacher..." />
          </SelectTrigger>
          <SelectContent>
            {schoolTeachers.value.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.first_name} {t.last_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
        disabled={!selectedTeacher.value || selectedSubjects.value.size === 0 || submitting.value}
        onClick={handleSubmit}
      >
        {submitting.value ? "Assigning..." : "Assign Teacher"}
      </Button>
    </div>
  );
}
