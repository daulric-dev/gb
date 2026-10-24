"use client";

import type { CourseGrade, GroupScore } from "@/lib/courses/types";
import { cn } from "@/lib/utils";
import { formatScore } from "@/lib/format-number";
import { formatPercent } from "./types";

/** Text, background and bar colours for a percent, by band. */
export function gradeTone(percent: number | null | undefined) {
  if (percent === null || percent === undefined || Number.isNaN(percent)) {
    return {
      text: "text-muted-foreground",
      badge: "bg-muted text-muted-foreground",
      bar: "bg-muted-foreground/40",
    };
  }
  if (percent >= 90) {
    return {
      text: "text-emerald-600 dark:text-emerald-400",
      badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      bar: "bg-emerald-500",
    };
  }
  if (percent >= 80) {
    return {
      text: "text-teal-600 dark:text-teal-400",
      badge: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
      bar: "bg-teal-500",
    };
  }
  if (percent >= 70) {
    return {
      text: "text-amber-600 dark:text-amber-400",
      badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      bar: "bg-amber-500",
    };
  }
  return {
    text: "text-red-600 dark:text-red-400",
    badge: "bg-red-500/15 text-red-700 dark:text-red-300",
    bar: "bg-red-500",
  };
}

/** A thin progress bar filled to `percent`. */
export function GradeBar({
  percent,
  toned = false,
  className,
}: {
  percent: number | null;
  /** Colour the fill by grade band instead of the primary colour. */
  toned?: boolean;
  className?: string;
}) {
  const width = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <div
      className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all",
          toned ? gradeTone(percent).bar : "bg-primary",
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/** Whether any group carries a weight, i.e. the course is weighted. */
export function isWeighted(grade: CourseGrade) {
  return grade.groups.some((g) => g.weight !== null && g.weight > 0);
}

/** One line per assignment group: name, weight, percent and a bar. */
export function GroupBreakdown({
  groups,
  weighted,
  compact = false,
}: {
  groups: GroupScore[];
  weighted: boolean;
  /** Smaller text and no earned/possible points, for overview lists. */
  compact?: boolean;
}) {
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">No groups yet.</p>;
  }
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {groups.map((g) => (
        <div key={g.groupId ?? "ungrouped"} className="space-y-1">
          <div
            className={cn(
              "flex items-baseline justify-between gap-3",
              compact ? "text-xs" : "text-sm",
            )}
          >
            <span className="min-w-0 truncate font-medium">
              {g.name}
              {weighted && g.weight !== null && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {formatScore(g.weight)}%{compact ? "" : " of grade"}
                </span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">
              {g.percent === null ? (
                <span className="text-muted-foreground">-</span>
              ) : (
                <>
                  {formatPercent(g.percent)}
                  {!compact && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {formatScore(g.earned)}/{formatScore(g.possible)}
                    </span>
                  )}
                </>
              )}
            </span>
          </div>
          <GradeBar
            percent={g.percent}
            toned={compact}
            className={compact ? "h-1" : undefined}
          />
        </div>
      ))}
    </div>
  );
}
