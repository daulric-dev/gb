"use client";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { WORK_STATE_LABELS, type ParentWorkItem } from "@/lib/parent";

export function formatWhen(value: string | null | undefined, withTime = false): string {
  if (!value) return "No due date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return withTime
    ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function Loading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function WorkList({ items, empty }: { items: ParentWorkItem[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((w) => (
        <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{w.title}</p>
            <p className="text-xs text-muted-foreground">
              {w.courseName ?? "Course"} · due {formatWhen(w.dueAt, true)}
              {w.hasExtension ? " (extended)" : ""}
            </p>
          </div>
          {w.score !== null && (
            <span className="text-sm tabular-nums" translate="no">
              {w.score} / {w.points}
            </span>
          )}
          <Badge variant={w.state === "missing" ? "destructive" : "outline"}>
            {WORK_STATE_LABELS[w.state]}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
