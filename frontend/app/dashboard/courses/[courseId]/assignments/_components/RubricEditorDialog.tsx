"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Rubric } from "@/lib/courses/types";
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

interface DraftRating {
  label: string;
  description: string;
  points: string;
}

interface DraftCriterion {
  title: string;
  description: string;
  points: string;
  ratings: DraftRating[];
}

function blankCriterion(): DraftCriterion {
  return {
    title: "",
    description: "",
    points: "5",
    ratings: [
      { label: "Full marks", description: "", points: "5" },
      { label: "Partial", description: "", points: "3" },
      { label: "Not shown", description: "", points: "0" },
    ],
  };
}

function fromRubric(r: Rubric): DraftCriterion[] {
  return r.criteria.map((c) => ({
    title: c.title,
    description: c.description ?? "",
    points: String(c.points),
    ratings: c.ratings.map((x) => ({
      label: x.label,
      description: x.description ?? "",
      points: String(x.points),
    })),
  }));
}

const TWO_DP = /^\d+(\.\d{1,2})?$/;

/**
 * Build or change a course rubric: criteria, each with its levels. A rubric
 * already used for marking can only be renamed - the server refuses new
 * criteria, so the form says so up front.
 */
export function RubricEditorDialog({
  open,
  courseId,
  rubric,
  onOpenChangeAction,
  onSavedAction,
}: {
  open: boolean;
  courseId: string;
  /** null to create a new one. */
  rubric: Rubric | null;
  onOpenChangeAction: (open: boolean) => void;
  onSavedAction: (rubric: Rubric) => void;
}) {
  useSignals();
  const title = useSignal("");
  const criteria = useSignal<DraftCriterion[]>([]);
  const working = useSignal(false);
  const locked = !!rubric?.assessed;

  useEffect(() => {
    if (!open) return;
    title.value = rubric?.title ?? "";
    criteria.value = rubric ? fromRubric(rubric) : [blankCriterion()];
  }, [open, rubric, title, criteria]);

  const update = (i: number, patch: Partial<DraftCriterion>) => {
    criteria.value = criteria.value.map((c, j) =>
      j === i ? { ...c, ...patch } : c,
    );
  };
  const updateRating = (i: number, k: number, patch: Partial<DraftRating>) => {
    const c = criteria.value[i];
    update(i, {
      ratings: c.ratings.map((r, j) => (j === k ? { ...r, ...patch } : r)),
    });
  };

  async function save() {
    const name = title.value.trim();
    if (!name) {
      toast.error("Give the rubric a title");
      return;
    }
    const body: Record<string, unknown> = { title: name };
    if (!locked) {
      const out = [];
      for (const c of criteria.value) {
        if (!c.title.trim()) {
          toast.error("Every criterion needs a title");
          return;
        }
        if (!TWO_DP.test(c.points.trim())) {
          toast.error(`Points for "${c.title}" must be a number`);
          return;
        }
        const points = Number(c.points);
        const ratings = [];
        for (const r of c.ratings) {
          if (!r.label.trim() || !TWO_DP.test(r.points.trim())) {
            toast.error(`Each level of "${c.title}" needs a label and points`);
            return;
          }
          if (Number(r.points) > points) {
            toast.error(`"${r.label}" is worth more than "${c.title}"`);
            return;
          }
          ratings.push({
            label: r.label.trim(),
            description: r.description.trim() || null,
            points: Number(r.points),
          });
        }
        if (ratings.length === 0) {
          toast.error(`"${c.title}" needs at least one level`);
          return;
        }
        out.push({
          title: c.title.trim(),
          description: c.description.trim() || null,
          points,
          ratings,
        });
      }
      if (out.length === 0) {
        toast.error("Add at least one criterion");
        return;
      }
      body.criteria = out;
    }

    working.value = true;
    try {
      const saved = rubric
        ? await api<Rubric>(`/courses/${courseId}/rubrics/${rubric.id}`, {
            method: "PATCH",
            body,
          })
        : await api<Rubric>(`/courses/${courseId}/rubrics`, {
            method: "POST",
            body,
          });
      toast.success(rubric ? "Rubric saved" : "Rubric created");
      onSavedAction(saved);
      onOpenChangeAction(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      working.value = false;
    }
  }

  const total = criteria.value.reduce(
    (s, c) => s + (Number(c.points) || 0),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{rubric ? "Edit rubric" : "New rubric"}</DialogTitle>
          <DialogDescription>
            {locked
              ? "This rubric has been used for marking, so only its title can change. Copy it to change the criteria."
              : "Rubrics belong to the course: build one once and attach it to any assignment or offline work."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label htmlFor="rubricTitle" className="text-xs">
            Title
          </Label>
          <Input
            id="rubricTitle"
            value={title.value}
            onChange={(e) => (title.value = e.target.value)}
            placeholder="Lab report rubric"
          />
        </div>

        <div className="space-y-3">
          {criteria.value.map((c, i) => (
            <div key={i} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <Input
                  value={c.title}
                  disabled={locked}
                  onChange={(e) => update(i, { title: e.target.value })}
                  placeholder="Criterion, e.g. Method"
                  aria-label="Criterion title"
                  className="flex-1"
                />
                <Input
                  value={c.points}
                  disabled={locked}
                  onChange={(e) => update(i, { points: e.target.value })}
                  inputMode="decimal"
                  aria-label="Criterion points"
                  className="w-20"
                />
                <span className="pt-2 text-xs text-muted-foreground">pts</span>
                {!locked && criteria.value.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove criterion"
                    onClick={() =>
                      (criteria.value = criteria.value.filter((_, j) => j !== i))
                    }
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                )}
              </div>
              <Input
                value={c.description}
                disabled={locked}
                onChange={(e) => update(i, { description: e.target.value })}
                placeholder="What this criterion looks for (optional)"
                aria-label="Criterion description"
              />
              <div className="space-y-1.5 border-l-2 pl-3">
                {c.ratings.map((r, k) => (
                  <div key={k} className="flex items-center gap-2">
                    <Input
                      value={r.label}
                      disabled={locked}
                      onChange={(e) => updateRating(i, k, { label: e.target.value })}
                      placeholder="Level"
                      aria-label="Level label"
                      className="h-8 w-36"
                    />
                    <Input
                      value={r.description}
                      disabled={locked}
                      onChange={(e) =>
                        updateRating(i, k, { description: e.target.value })
                      }
                      placeholder="Description (optional)"
                      aria-label="Level description"
                      className="h-8 flex-1"
                    />
                    <Input
                      value={r.points}
                      disabled={locked}
                      onChange={(e) => updateRating(i, k, { points: e.target.value })}
                      inputMode="decimal"
                      aria-label="Level points"
                      className="h-8 w-16"
                    />
                    {!locked && c.ratings.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove level"
                        onClick={() =>
                          update(i, {
                            ratings: c.ratings.filter((_, j) => j !== k),
                          })
                        }
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
                {!locked && c.ratings.length < 10 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      update(i, {
                        ratings: [
                          ...c.ratings,
                          { label: "", description: "", points: "0" },
                        ],
                      })
                    }
                  >
                    <Plus className="mr-1 size-3.5" />
                    Level
                  </Button>
                )}
              </div>
            </div>
          ))}
          {!locked && criteria.value.length < 30 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                (criteria.value = [...criteria.value, blankCriterion()])
              }
            >
              <Plus className="mr-1.5 size-4" />
              Add criterion
            </Button>
          )}
        </div>

        <DialogFooter className="items-center">
          <span className="mr-auto text-sm text-muted-foreground">
            Worth {Math.round(total * 100) / 100} points
          </span>
          <Button
            variant="outline"
            onClick={() => onOpenChangeAction(false)}
            disabled={working.value}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={working.value}>
            {working.value && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
