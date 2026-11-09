"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { BankDraw } from "./types";

interface CourseBank {
  id: string;
  title: string;
  questionCount: number;
}

export function BankDrawsDialog({
  open,
  activityId,
  courseId,
  initialDraws = [],
  onOpenChangeAction,
  onSavedAction,
}: {
  open: boolean;
  activityId: string;
  courseId: string;
  initialDraws?: BankDraw[];
  onOpenChangeAction: (open: boolean) => void;
  onSavedAction: () => void;
}) {
  useSignals();
  const banks = useSignal<CourseBank[]>([]);
  const loadingSignal = useSignal<boolean>(false);
  const loading = loadingSignal.value;
  const saving = useSignal(false);
  const drawsSignal = useSignal<{ bankId: string; count: number }[]>([]);
  const draws = drawsSignal.value;
  const setDraws = (value: { bankId: string; count: number }[]) => (drawsSignal.value = value);

  useEffect(() => {
    if (!open) return;
    drawsSignal.value = initialDraws.map((d) => ({
      bankId: d.bankId,
      count: d.count,
    }));
    loadingSignal.value = true;
    api<CourseBank[]>(`/courses/${courseId}/question-banks`)
      .then((data) => (banks.value = data ?? []))
      .catch((err) => toast.error(userMessage(err, "Failed to load question banks")))
      .finally(() => (loadingSignal.value = false));
  }, [open, courseId, initialDraws, drawsSignal, loadingSignal, banks]);

  function addDraw() {
    const unused = banks.value.find((b) => !draws.some((d) => d.bankId === b.id));
    if (!unused) {
      toast.error("All available question banks are already added");
      return;
    }
    setDraws([...draws, { bankId: unused.id, count: Math.min(unused.questionCount || 1, 5) }]);
  }

  function removeDraw(idx: number) {
    setDraws(draws.filter((_, i) => i !== idx));
  }

  function updateDraw(idx: number, patch: Partial<{ bankId: string; count: number }>) {
    setDraws(
      draws.map((d, i) => {
        if (i !== idx) return d;
        const next = { ...d, ...patch };
        const b = banks.value.find((item) => item.id === next.bankId);
        if (b && next.count > b.questionCount) {
          next.count = Math.max(1, b.questionCount);
        }
        return next;
      }),
    );
  }

  async function save() {
    for (const d of draws) {
      const b = banks.value.find((item) => item.id === d.bankId);
      if (!b) continue;
      if (d.count < 1) {
        toast.error(`Draw count for "${b.title}" must be at least 1`);
        return;
      }
      if (d.count > b.questionCount) {
        toast.error(
          `Cannot draw ${d.count} questions from "${b.title}" (only ${b.questionCount} in bank)`,
        );
        return;
      }
    }

    saving.value = true;
    try {
      await api(`/activities/${activityId}/bank-draws`, {
        method: "PUT",
        body: { draws },
      });
      toast.success("Question bank draws saved");
      onOpenChangeAction(false);
      onSavedAction();
    } catch (err) {
      toast.error(userMessage(err, "Failed to save bank draws"));
    } finally {
      saving.value = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Question bank draws</DialogTitle>
          <DialogDescription>
            Draw random questions from course banks for each student attempt.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : banks.value.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No question banks created for this course yet. Create question banks from the Assignments page first.
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {draws.map((d, i) => {
              const b = banks.value.find((item) => item.id === d.bankId);
              return (
                <div key={i} className="flex items-center gap-2 rounded-lg border p-3">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Question bank</Label>
                    <Select
                      value={d.bankId}
                      onValueChange={(val) => updateDraw(i, { bankId: val as string })}
                      items={banks.value.map((item) => ({
                        value: item.id,
                        label: `${item.title} (${item.questionCount} questions)`,
                      }))}
                    >
                      <SelectTrigger className="w-full text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {banks.value.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.title} ({item.questionCount} questions)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-24 space-y-1">
                    <Label className="text-xs">Draw count</Label>
                    <Input
                      type="number"
                      min={1}
                      max={b?.questionCount || 100}
                      value={d.count}
                      onChange={(e) => updateDraw(i, { count: Number(e.target.value) || 1 })}
                      className="text-xs"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-5 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeDraw(i)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}

            {draws.length < banks.value.length && (
              <Button type="button" variant="outline" size="sm" onClick={addDraw}>
                <Plus className="mr-2 size-4" />
                Add bank draw
              </Button>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChangeAction(false)} disabled={saving.value}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving.value || banks.value.length === 0}>
            {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save draws
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
