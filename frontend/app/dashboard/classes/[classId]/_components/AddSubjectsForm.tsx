"use client";

import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Subject } from "./types";

export function AddSubjectsForm({
  classId,
  studentId,
  available,
  onSuccess,
  onCancel,
}: {
  classId: string;
  studentId: string;
  available: Subject[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  useSignals();
  const selected = useSignal<Set<string>>(new Set());
  const submitting = useSignal(false);

  function toggleSubject(id: string) {
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

  async function handleAssign() {
    if (selected.value.size === 0) return;
    submitting.value = true;

    try {
      await api(`/classes/${classId}/subjects`, {
        method: "POST",
        body: { studentId, subjectIds: [...selected.value] },
      });
      toast.success(`${selected.value.size} subject${selected.value.size > 1 ? "s" : ""} assigned`);
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to assign";
      toast.error(msg);
    } finally {
      submitting.value = false;
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <label className="flex items-center gap-3 px-2 cursor-pointer select-none">
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
      <div className="max-h-48 overflow-y-auto divide-y border-t pt-1">
        {available.map((s) => (
          <label
            key={s.id}
            className="flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-accent/50 transition-colors rounded-sm"
          >
            <input
              type="checkbox"
              checked={selected.value.has(s.id)}
              onChange={() => toggleSubject(s.id)}
              className="size-4 rounded border-input"
            />
            <span className="text-sm font-medium">{s.name}</span>
            {s.code && (
              <Badge variant="secondary" className="text-xs ml-auto">
                {s.code}
              </Badge>
            )}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={selected.value.size === 0 || submitting.value}
          onClick={handleAssign}
          className="flex-1"
        >
          {submitting.value ? "Assigning..." : `Assign ${selected.value.size}`}
        </Button>
      </div>
    </div>
  );
}
