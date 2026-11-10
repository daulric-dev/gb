"use client";

import type { Rubric } from "@/lib/courses/types";
import { reviewTotal, type ReviewMark } from "@/lib/peer-review";

/** A review, read-only: rubric marks (if any) and the comment. */
export function ReviewView({
  rubric,
  marks,
  comment,
}: {
  rubric: Rubric | null | undefined;
  marks: ReviewMark[];
  comment: string | null;
}) {
  const total = reviewTotal(marks);
  return (
    <div className="space-y-3 text-sm">
      {rubric && marks.length > 0 && (
        <dl className="space-y-2">
          {rubric.criteria.map((c) => {
            const m = marks.find((x) => x.criterionId === c.id);
            const level = m?.ratingId ? c.ratings.find((r) => r.id === m.ratingId) : null;
            return (
              <div key={c.id} className="rounded-md border p-2">
                <dt className="font-medium">{c.title}</dt>
                <dd className="text-muted-foreground">
                  {m ? `${level ? `${level.label} · ` : ""}${m.points} / ${c.points}` : "Not marked"}
                  {m?.comment && <span className="mt-1 block whitespace-pre-wrap text-foreground">{m.comment}</span>}
                </dd>
              </div>
            );
          })}
          {total !== null && (
            <p className="text-right font-medium">
              Total {total} / {rubric.pointsPossible}
            </p>
          )}
        </dl>
      )}
      {comment ? (
        <p className="whitespace-pre-wrap">{comment}</p>
      ) : (
        !marks.length && <p className="text-muted-foreground">No comment.</p>
      )}
    </div>
  );
}
