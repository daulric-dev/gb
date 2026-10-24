import type { Rubric, RubricAssessment } from "@/lib/courses/types";
import { cn } from "@/lib/utils";

/**
 * A rubric as a read-only grid: one row per criterion, its levels across.
 * With `assessments`, the level each criterion was given is highlighted and
 * any comment shown under it - the student's view of how they were marked.
 */
export function RubricGrid({
  rubric,
  assessments,
  className,
}: {
  rubric: Rubric;
  assessments?: RubricAssessment[] | null;
  className?: string;
}) {
  const byCriterion = new Map(
    (assessments ?? []).map((a) => [a.criterionId, a]),
  );
  const total = assessments
    ? Math.round(assessments.reduce((s, a) => s + a.points, 0) * 100) / 100
    : null;

  return (
    <div className={cn("overflow-x-auto rounded-lg border", className)}>
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-left text-xs">
          <tr>
            <th className="w-1/4 px-3 py-2 font-medium">Criterion</th>
            <th className="px-3 py-2 font-medium">Levels</th>
            <th className="w-20 px-3 py-2 text-right font-medium">Points</th>
          </tr>
        </thead>
        <tbody>
          {rubric.criteria.map((c) => {
            const mark = byCriterion.get(c.id);
            return (
              <tr key={c.id} className="border-t align-top">
                <td className="px-3 py-2">
                  <p className="font-medium">{c.title}</p>
                  {c.description && (
                    <p className="text-xs text-muted-foreground">
                      {c.description}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    {c.ratings.map((r) => (
                      <div
                        key={r.id}
                        className={cn(
                          "min-w-28 flex-1 rounded-md border px-2 py-1.5",
                          mark?.ratingId === r.id &&
                            "border-primary bg-primary/10 ring-1 ring-primary",
                        )}
                      >
                        <p className="flex justify-between gap-2 text-xs font-medium">
                          <span>{r.label}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {r.points}
                          </span>
                        </p>
                        {r.description && (
                          <p className="text-xs text-muted-foreground">
                            {r.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  {mark?.comment && (
                    <p className="mt-1.5 text-xs italic text-muted-foreground">
                      &ldquo;{mark.comment}&rdquo;
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {mark ? (
                    <>
                      <span className="font-medium">{mark.points}</span>
                      <span className="text-muted-foreground">/{c.points}</span>
                    </>
                  ) : (
                    c.points
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/30 font-medium">
            <td className="px-3 py-2" colSpan={2}>
              Total
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {total !== null ? `${total}/` : ""}
              {rubric.pointsPossible}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
