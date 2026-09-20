"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Scheme } from "./types";

/**
 * The weighted scheme for a class in a term - Assignments 20%, Quizzes 20%,
 * Exam 60%. Every subject the class takes follows it.
 *
 * Weights are not forced to total 100; the running total is shown instead,
 * because the engine renormalises and blocking mid-edit would be worse than
 * letting a teacher finish. Adding the first group to a class copies the
 * inherited scheme server-side, so this never starts from a blank slate.
 */
export function SchemeEditor({
  open,
  termId,
  classId,
  className,
  canEdit,
  onOpenChangeAction,
  onChangedAction,
}: {
  open: boolean;
  termId: string;
  classId: string;
  className: string;
  canEdit: boolean;
  onOpenChangeAction: (open: boolean) => void;
  onChangedAction?: () => void;
}) {
  useSignals();

  const scheme = useSignal<Scheme | null>(null);
  const loading = useSignal(true);
  const working = useSignal(false);
  const newName = useSignal("");
  const newWeight = useSignal("20");

  const load = useCallback(() => {
    if (!termId || !classId) return;
    loading.value = true;
    api<Scheme>(`/grading-groups?termId=${termId}&studentGroupId=${classId}`)
      .then((data) => (scheme.value = data))
      .catch(() => (scheme.value = null))
      .finally(() => (loading.value = false));
  }, [termId, classId, loading, scheme]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function addGroup() {
    const name = newName.value.trim();
    const weight = Number(newWeight.value);

    if (!name) {
      toast.error("Give the group a name");
      return;
    }
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
      toast.error("Weight must be between 0 and 100");
      return;
    }

    working.value = true;
    try {
      await api("/grading-groups", {
        method: "POST",
        body: { termId, studentGroupId: classId, name, weight },
      });
      newName.value = "";
      load();
      onChangedAction?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to add group");
    } finally {
      working.value = false;
    }
  }

  async function setWeight(groupId: string, weight: number) {
    try {
      await api(`/grading-groups/${groupId}`, {
        method: "PATCH",
        body: { weight, studentGroupId: classId },
      });
      load();
      onChangedAction?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
    }
  }

  async function remove(groupId: string) {
    try {
      await api(`/grading-groups/${groupId}?studentGroupId=${classId}`, {
        method: "DELETE",
      });
      load();
      onChangedAction?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove");
    }
  }

  const total = scheme.value?.totalWeight ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Grading scheme</DialogTitle>
          <DialogDescription>
            How work in {className || "this class"} is weighted this term,
            across every subject it takes. Work is averaged inside each group,
            then the groups are weighted against each other.
          </DialogDescription>
        </DialogHeader>

        {loading.value ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-2">
            {!scheme.value?.isClassSpecific &&
              (scheme.value?.groups.length ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">
                  Using the school&apos;s default for this term. Changing a
                  weight or adding a group starts a scheme just for this class.
                </p>
              )}

            {scheme.value?.groups.map((group) => (
              <div
                key={group.id}
                className="flex items-center gap-2 rounded-md border px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {group.name}
                  {group.isExam && (
                    <Badge variant="secondary" className="ml-2">
                      Exam
                    </Badge>
                  )}
                </span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={group.weight}
                  disabled={!canEdit}
                  className="h-8 w-20"
                  onBlur={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next) && next !== group.weight) {
                      void setWeight(group.id, next);
                    }
                  }}
                />
                <span className="text-sm text-muted-foreground">%</span>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(group.id)}
                    title="Remove group"
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}

            {(scheme.value?.groups.length ?? 0) === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No groups yet. Add one to start weighting this class.
              </p>
            )}

            <div className="flex items-center justify-between pt-1 text-sm">
              <span className="text-muted-foreground">Total</span>
              <span
                className={cn(
                  "font-medium",
                  total !== 100 && "text-amber-600 dark:text-amber-500",
                )}
              >
                {total}%
                {total !== 100 && (
                  <span className="ml-2 text-xs font-normal">
                    grades are scaled to this total
                  </span>
                )}
              </span>
            </div>

            {canEdit && (
              <div className="flex items-end gap-2 border-t pt-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor="groupName" className="text-xs">
                    New group
                  </Label>
                  <Input
                    id="groupName"
                    placeholder="Assignments"
                    value={newName.value}
                    onChange={(e) => (newName.value = e.target.value)}
                  />
                </div>
                <div className="w-24 space-y-1">
                  <Label htmlFor="groupWeight" className="text-xs">
                    Weight
                  </Label>
                  <Input
                    id="groupWeight"
                    type="number"
                    min={0}
                    max={100}
                    value={newWeight.value}
                    onChange={(e) => (newWeight.value = e.target.value)}
                  />
                </div>
                <Button onClick={addGroup} disabled={working.value}>
                  {working.value ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChangeAction(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
