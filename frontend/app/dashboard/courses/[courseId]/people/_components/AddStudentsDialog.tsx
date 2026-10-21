"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Search } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Student } from "@/app/dashboard/students/_components/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function studentName(s: Student) {
  return `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || "Unnamed";
}

/** Pick any number of students from the school roster to enrol. */
export function AddStudentsDialog({
  open,
  courseId,
  enrolled,
  onOpenChangeAction,
  onAddedAction,
}: {
  open: boolean;
  courseId: string;
  /** student ids with an active enrolment already */
  enrolled: string[];
  onOpenChangeAction: (open: boolean) => void;
  onAddedAction: () => void;
}) {
  useSignals();
  const roster = useSignal<Student[]>([]);
  const loading = useSignal(true);
  const search = useSignal("");
  const selected = useSignal<Set<string>>(new Set());
  const saving = useSignal(false);

  useEffect(() => {
    if (!open) return;
    search.value = "";
    selected.value = new Set();
    loading.value = true;
    api<Student[]>("/students")
      .then((data) => (roster.value = data))
      .catch(() => toast.error("Failed to load students"))
      .finally(() => (loading.value = false));
  }, [open, roster, loading, search, selected]);

  const taken = new Set(enrolled);
  const q = search.value.trim().toLowerCase();
  const candidates = roster.value
    .filter((s) => s.is_active && !taken.has(s.id))
    .filter((s) => !q || studentName(s).toLowerCase().includes(q))
    .sort((a, b) => studentName(a).localeCompare(studentName(b)));

  function toggle(id: string) {
    const next = new Set(selected.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected.value = next;
  }

  const allVisibleSelected =
    candidates.length > 0 && candidates.every((s) => selected.value.has(s.id));

  function toggleAllVisible() {
    const next = new Set(selected.value);
    for (const s of candidates) {
      if (allVisibleSelected) next.delete(s.id);
      else next.add(s.id);
    }
    selected.value = next;
  }

  async function add() {
    const studentIds = [...selected.value];
    if (studentIds.length === 0) return;
    saving.value = true;
    try {
      await api(`/courses/${courseId}/students`, {
        method: "POST",
        body: { studentIds },
      });
      toast.success(
        `${studentIds.length} ${studentIds.length === 1 ? "student" : "students"} enrolled`,
      );
      onOpenChangeAction(false);
      onAddedAction();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to enrol");
    } finally {
      saving.value = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add students</DialogTitle>
          <DialogDescription>
            Choose from your school&apos;s roster.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name"
              className="pl-8"
              value={search.value}
              onChange={(e) => (search.value = e.target.value)}
            />
          </div>

          {!loading.value && candidates.length > 0 && (
            <label className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={toggleAllVisible}
              />
              Select all {q ? "matching" : ""} ({candidates.length})
            </label>
          )}

          <div className="max-h-80 space-y-0.5 overflow-y-auto rounded-md border p-1">
            {loading.value ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))
            ) : candidates.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {q ? "No one matches." : "Everyone is already enrolled."}
              </p>
            ) : (
              candidates.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={selected.value.has(s.id)}
                    onCheckedChange={() => toggle(s.id)}
                  />
                  <span className="flex-1 truncate">{studentName(s)}</span>
                  {!s.user_profile_id && (
                    <span className="text-xs text-muted-foreground">
                      No account
                    </span>
                  )}
                </label>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChangeAction(false)}
            disabled={saving.value}
          >
            Cancel
          </Button>
          <Button
            onClick={add}
            disabled={selected.value.size === 0 || saving.value}
          >
            {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
            Enrol {selected.value.size || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
