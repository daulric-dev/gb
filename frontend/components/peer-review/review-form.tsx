"use client";

import type { Rubric } from "@/lib/courses/types";
import type { ReviewMark } from "@/lib/peer-review";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

/**
 * The reviewer's form: a level (or points) per rubric criterion with an
 * optional note, and an overall comment. Controlled; state lives in the
 * caller's signals.
 */
export function ReviewForm({
  rubric,
  marks,
  comment,
  disabled,
  onMarksChange,
  onCommentChange,
}: {
  rubric: Rubric | null;
  marks: ReviewMark[];
  comment: string;
  disabled: boolean;
  onMarksChange: (marks: ReviewMark[]) => void;
  onCommentChange: (comment: string) => void;
}) {
  const setMark = (criterionId: string, patch: Partial<ReviewMark>) => {
    const current = marks.find((m) => m.criterionId === criterionId) ?? {
      criterionId,
      ratingId: null,
      points: 0,
      comment: null,
    };
    onMarksChange([
      ...marks.filter((m) => m.criterionId !== criterionId),
      { ...current, ...patch },
    ]);
  };

  return (
    <div className="space-y-4">
      {rubric?.criteria.map((c) => {
        const mark = marks.find((m) => m.criterionId === c.id);
        return (
          <fieldset key={c.id} className="space-y-2 rounded-md border p-3" disabled={disabled}>
            <legend className="px-1 text-sm font-medium">
              {c.title} <span className="text-muted-foreground">({c.points} pts)</span>
            </legend>
            {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
            {c.ratings.length > 0 ? (
              <div role="radiogroup" aria-label={c.title} className="flex flex-wrap gap-2">
                {c.ratings.map((r) => {
                  const selected = mark?.ratingId === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={disabled}
                      onClick={() => setMark(c.id, { ratingId: r.id, points: r.points })}
                      className={`rounded-md border px-3 py-1.5 text-left text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${
                        selected ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"
                      }`}
                    >
                      {r.label} · {r.points}
                      {selected && <span className="sr-only"> (selected)</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Label htmlFor={`points-${c.id}`}>Points</Label>
                <Input
                  id={`points-${c.id}`}
                  type="number"
                  min={0}
                  max={c.points}
                  step="0.5"
                  className="w-24"
                  value={mark ? String(mark.points) : ""}
                  onChange={(e) =>
                    setMark(c.id, { ratingId: null, points: Number(e.target.value) || 0 })
                  }
                />
              </div>
            )}
            <Label htmlFor={`note-${c.id}`} className="text-xs">
              Note on {c.title} (optional)
            </Label>
            <Textarea
              id={`note-${c.id}`}
              rows={2}
              maxLength={2000}
              value={mark?.comment ?? ""}
              onChange={(e) => setMark(c.id, { comment: e.target.value || null })}
            />
          </fieldset>
        );
      })}
      <div className="space-y-1.5">
        <Label htmlFor="review-comment">{rubric ? "Overall comment (optional)" : "Your review"}</Label>
        <Textarea
          id="review-comment"
          rows={6}
          maxLength={10000}
          disabled={disabled}
          value={comment}
          placeholder="What works well, and what would make it better?"
          onChange={(e) => onCommentChange(e.target.value)}
        />
      </div>
    </div>
  );
}
