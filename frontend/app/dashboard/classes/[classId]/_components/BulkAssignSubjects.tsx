"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckSquare, Search } from "lucide-react";
import { selectClass, type EnrolledStudent, type Subject } from "./types";

export function BulkAssignSubjects({
  classId,
  enrolled,
  onSuccess,
}: {
  classId: string;
  enrolled: EnrolledStudent[];
  onSuccess: () => void;
}) {
  useSignals();
  const allSubjects = useSignal<Subject[]>([]);
  const loading = useSignal(true);
  const submitting = useSignal(false);
  const selectedSubjectId = useSignal("");
  const selectedStudents = useSignal<Set<string>>(new Set());
  const searchQuery = useSignal("");

  useEffect(() => {
    api<Subject[]>("/subjects")
      .then((data) => (allSubjects.value = data))
      .catch(() => toast.error("Failed to load subjects"))
      .finally(() => (loading.value = false));
  }, []);

  const q = searchQuery.value.toLowerCase();
  const filteredEnrolled = q
    ? enrolled.filter(
        (e) =>
          e.student.first_name.toLowerCase().includes(q) ||
          e.student.last_name.toLowerCase().includes(q),
      )
    : enrolled;

  const alreadyAssigned = new Set(
    enrolled
      .filter((e) =>
        e.subjects?.some((s) => s.id === selectedSubjectId.value),
      )
      .map((e) => e.student.id),
  );

  const unassignedStudents = enrolled.filter(
    (e) => !alreadyAssigned.has(e.student.id),
  );
  const allSelected =
    unassignedStudents.length > 0 &&
    unassignedStudents.every((e) => selectedStudents.value.has(e.student.id));

  function toggleStudent(id: string) {
    const next = new Set(selectedStudents.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedStudents.value = next;
  }

  function toggleAll() {
    if (allSelected) {
      selectedStudents.value = new Set();
    } else {
      selectedStudents.value = new Set(
        unassignedStudents.map((e) => e.student.id),
      );
    }
  }

  async function handleAssign() {
    if (!selectedSubjectId.value || selectedStudents.value.size === 0) return;
    submitting.value = true;

    try {
      await api(`/classes/${classId}/subjects/bulk`, {
        method: "POST",
        body: {
          studentIds: [...selectedStudents.value],
          subjectIds: [selectedSubjectId.value],
        },
      });
      toast.success(
        `Subject assigned to ${selectedStudents.value.size} student${selectedStudents.value.size !== 1 ? "s" : ""}`,
      );
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

  if (allSubjects.value.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground">
        No subjects available. Create subjects first.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Subject</label>
        <select
          className={selectClass}
          value={selectedSubjectId.value}
          onChange={(e) => {
            selectedSubjectId.value = e.target.value;
            selectedStudents.value = new Set();
          }}
        >
          <option value="">Select a subject...</option>
          {allSubjects.value.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.code ? `(${s.code})` : ""}
            </option>
          ))}
        </select>
      </div>

      {selectedSubjectId.value && (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Students</label>
              <button
                type="button"
                onClick={toggleAll}
                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <CheckSquare className="size-3.5" />
                {allSelected ? "Deselect All" : "Select All"}
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search students..."
                value={searchQuery.value}
                onChange={(e) => (searchQuery.value = e.target.value)}
                className={`${selectClass} pl-9`}
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
              {filteredEnrolled.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No students match &quot;{searchQuery.value}&quot;
                </div>
              ) : (
                filteredEnrolled.map((e) => {
                  const isAssigned = alreadyAssigned.has(e.student.id);
                  return (
                    <label
                      key={e.student.id}
                      className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${isAssigned ? "opacity-60 cursor-default" : "cursor-pointer hover:bg-accent/50"}`}
                    >
                      <input
                        type="checkbox"
                        checked={isAssigned || selectedStudents.value.has(e.student.id)}
                        disabled={isAssigned}
                        onChange={() => toggleStudent(e.student.id)}
                        className="size-4 rounded border-input"
                      />
                      <span className="text-sm font-medium">
                        {e.student.first_name} {e.student.last_name}
                      </span>
                      <div className="ml-auto flex items-center gap-1.5">
                        {isAssigned && (
                          <Badge className="text-xs">Assigned</Badge>
                        )}
                        <Badge variant="outline" className="capitalize text-xs">
                          {e.student.gender}
                        </Badge>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <Button
            className="w-full"
            disabled={
              selectedStudents.value.size === 0 || submitting.value
            }
            onClick={handleAssign}
          >
            {submitting.value
              ? "Assigning..."
              : `Assign to ${selectedStudents.value.size} Student${selectedStudents.value.size !== 1 ? "s" : ""}`}
          </Button>
        </>
      )}
    </div>
  );
}
