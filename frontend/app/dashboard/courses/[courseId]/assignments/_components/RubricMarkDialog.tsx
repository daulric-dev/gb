"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type {
  Rubric,
  RubricAssessment,
  SubmissionStatus,
} from "@/lib/courses/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** PUT /activities/:id/submissions/:studentId/rubric */
export interface RubricMarkResult {
  submission: {
    id: string;
    studentId: string;
    status: SubmissionStatus;
    score: number | null;
    feedback: string | null;
    excused: boolean;
    excusedReason: string | null;
    gradedAt: string | null;
  };
  assessments: RubricAssessment[];
  rubricTotal: number;
}

interface CriterionPick {
  ratingId: string | null;
  points: number | null;
  comment: string;
}

/**
 * Mark one student with the rubric: a level per criterion, an optional
 * comment on each, and the total becomes the score unless overridden.
 */
export function RubricMarkDialog({
  open,
  activityId,
  points,
  rubric,
  student,
  existing,
  feedback,
  onOpenChangeAction,
  onSavedAction,
}: {
  open: boolean;
  activityId: string;
  points: number;
  rubric: Rubric;
  student: { studentId: string; name: string } | null;
  existing: RubricAssessment[];
  feedback: string | null;
  onOpenChangeAction: (open: boolean) => void;
  onSavedAction: (result: RubricMarkResult) => void;
}) {
  useSignals();
  const picks = useSignal<Record<string, CriterionPick>>({});
  const override = useSignal("");
  const note = useSignal("");
  const working = useSignal(false);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, CriterionPick> = {};
    for (const a of existing) {
      next[a.criterionId] = {
        ratingId: a.ratingId,
        points: a.points,
        comment: a.comment ?? "",
      };
    }
    picks.value = next;
    override.value = "";
    note.value = feedback ?? "";
    // Reset only when the dialog opens for a student, not on every render
    // that hands in a fresh (but equal) `existing` array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student?.studentId]);

  const set = (criterionId: string, patch: Partial<CriterionPick>) => {
    const was = picks.value[criterionId] ?? {
      ratingId: null,
      points: null,
      comment: "",
    };
    picks.value = { ...picks.value, [criterionId]: { ...was, ...patch } };
  };

  const total =
    Math.round(
      rubric.criteria.reduce(
        (s, c) => s + (picks.value[c.id]?.points ?? 0),
        0,
      ) * 100,
    ) / 100;
  const unmarked = rubric.criteria.filter(
    (c) => picks.value[c.id]?.points == null,
  ).length;

  async function save() {
    if (!student) return;
    const raw = override.value.trim();
    let score: number | undefined;
    if (raw !== "") {
      score = Number(raw);
      if (!/^\d+(\.\d{1,2})?$/.test(raw) || score > points) {
        toast.error(`Score must be between 0 and ${points}, two decimals at most`);
        return;
      }
    } else if (total > points) {
      toast.error(
        `The rubric adds up to ${total}, more than ${points}. Give a score to override it.`,
      );
      return;
    }

    working.value = true;
    try {
      const result = await api<RubricMarkResult>(
        `/activities/${activityId}/submissions/${student.studentId}/rubric`,
        {
          method: "PUT",
          body: {
            assessments: rubric.criteria
              .filter((c) => picks.value[c.id]?.points != null)
              .map((c) => {
                const p = picks.value[c.id];
                return {
                  criterionId: c.id,
                  ...(p.ratingId ? { ratingId: p.ratingId } : {}),
                  points: p.points,
                  comment: p.comment.trim() || null,
                };
              }),
            ...(score !== undefined ? { score } : {}),
            feedback: note.value.trim(),
          },
        },
      );
      toast.success(`${student.name}: ${result.submission.score}/${points}`);
      onSavedAction(result);
      onOpenChangeAction(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save mark");
    } finally {
      working.value = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Mark {student?.name}</DialogTitle>
          <DialogDescription>
            {rubric.title}. Pick a level for each criterion; the total becomes
            the mark unless you enter a score.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {rubric.criteria.map((c) => {
            const pick = picks.value[c.id];
            return (
              <div key={c.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <p className="font-medium">{c.title}</p>
                    {c.description && (
                      <p className="text-xs text-muted-foreground">
                        {c.description}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {pick?.points ?? "-"}/{c.points}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.ratings.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() =>
                        pick?.ratingId === r.id
                          ? set(c.id, { ratingId: null, points: null })
                          : set(c.id, { ratingId: r.id, points: r.points })
                      }
                      className={cn(
                        "min-w-28 flex-1 rounded-md border px-2 py-1.5 text-left hover:bg-muted/60",
                        pick?.ratingId === r.id &&
                          "border-primary bg-primary/10 ring-1 ring-primary",
                      )}
                    >
                      <span className="flex justify-between gap-2 text-xs font-medium">
                        <span>{r.label}</span>
                        <span className="tabular-nums">{r.points}</span>
                      </span>
                      {r.description && (
                        <span className="block text-xs text-muted-foreground">
                          {r.description}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <Input
                  value={pick?.comment ?? ""}
                  onChange={(e) => set(c.id, { comment: e.target.value })}
                  placeholder="Comment on this criterion (optional)"
                  aria-label={`Comment on ${c.title}`}
                  className="h-8"
                />
              </div>
            );
          })}

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1">
              <Label htmlFor="rubricFeedback" className="text-xs">
                Feedback
              </Label>
              <Textarea
                id="rubricFeedback"
                rows={3}
                value={note.value}
                onChange={(e) => (note.value = e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rubricOverride" className="text-xs">
                Score override
              </Label>
              <Input
                id="rubricOverride"
                inputMode="decimal"
                placeholder={String(total)}
                value={override.value}
                onChange={(e) => (override.value = e.target.value)}
                className="w-28"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="items-center">
          <span className="mr-auto text-sm text-muted-foreground">
            Rubric total{" "}
            <span className="font-medium text-foreground">
              {total}/{rubric.pointsPossible}
            </span>
            {unmarked > 0 && ` · ${unmarked} not marked`}
          </span>
          <Button
            variant="outline"
            onClick={() => onOpenChangeAction(false)}
            disabled={working.value}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={working.value || !student}>
            {working.value && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save mark
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
