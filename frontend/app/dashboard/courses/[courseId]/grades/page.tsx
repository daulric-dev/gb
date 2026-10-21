"use client";

import { useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { BarChart3, Download, Loader2, Search } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { downloadFromUrl } from "@/lib/download";
import type {
  Activity,
  AssignmentGroup,
  Gradebook,
  GradebookCell,
} from "@/lib/courses/types";
import { formatPercent, personName } from "@/lib/courses/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useCourse } from "../_components/course-context";
import { SectionHeader } from "../_components/SectionHeader";

interface Column {
  group: { id: string | null; name: string; weight: number | null };
  activities: Activity[];
}

/** Activities grouped by assignment group, groups in their own order. */
function buildColumns(groups: AssignmentGroup[], activities: Activity[]): Column[] {
  const ordered = [...groups].sort((a, b) => a.position - b.position);
  const known = new Set(ordered.map((g) => g.id));
  const columns: Column[] = ordered
    .map((g) => ({
      group: { id: g.id, name: g.name, weight: g.weight },
      activities: activities.filter((a) => a.assignmentGroupId === g.id),
    }))
    .filter((c) => c.activities.length > 0);
  const rest = activities.filter(
    (a) => !a.assignmentGroupId || !known.has(a.assignmentGroupId),
  );
  if (rest.length) {
    columns.push({
      group: { id: null, name: "Ungrouped", weight: null },
      activities: rest,
    });
  }
  return columns;
}

function Cell({
  cell,
  activity,
}: {
  cell: GradebookCell | undefined;
  activity: Activity;
}) {
  if (cell?.excused) {
    return (
      <span className="font-medium text-amber-600 dark:text-amber-500" title="Excused">
        EX
      </span>
    );
  }
  if (cell?.score !== null && cell?.score !== undefined) {
    const pct = activity.points ? cell.score / activity.points : 0;
    return (
      <span
        className={cn(
          "tabular-nums",
          pct < 0.5 && "text-destructive",
          activity.omitFromFinalGrade && "text-muted-foreground line-through",
        )}
      >
        {cell.score}
      </span>
    );
  }
  if (cell?.status === "submitted") {
    return (
      <span
        className="inline-block size-2 rounded-full bg-sky-500"
        title="Handed in, needs marking"
      />
    );
  }
  return <span className="text-muted-foreground/50">-</span>;
}

export default function CourseGradesPage() {
  useSignals();
  const { course, base } = useCourse();

  const book = useSignal<Gradebook | null>(null);
  const loading = useSignal(true);
  const exporting = useSignal(false);
  const search = useSignal("");
  const showInactive = useSignal(false);

  useEffect(() => {
    api<Gradebook>(`/courses/${course.id}/gradebook`)
      .then((data) => (book.value = data))
      .catch(() => toast.error("Failed to load the gradebook"))
      .finally(() => (loading.value = false));
  }, [course.id, book, loading]);

  async function exportCsv() {
    exporting.value = true;
    try {
      const safe = (course.code || course.name).replace(/[^\w-]+/g, "_");
      await downloadFromUrl(
        `/courses/${course.id}/gradebook/export`,
        `${safe}-grades.csv`,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      exporting.value = false;
    }
  }

  const header = (
    <SectionHeader
      title="Grades"
      description="Current grade: marked work only, excused and omitted work left out"
      actions={
        <Button
          variant="outline"
          onClick={exportCsv}
          disabled={exporting.value || !book.value}
        >
          {exporting.value ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Download className="mr-2 size-4" />
          )}
          Export CSV
        </Button>
      }
    />
  );

  if (loading.value) {
    return (
      <div className="space-y-5">
        {header}
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const gb = book.value;
  if (!gb || gb.students.length === 0 || gb.activities.length === 0) {
    return (
      <div className="space-y-5">
        {header}
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BarChart3 />
            </EmptyMedia>
            <EmptyTitle>
              {!gb
                ? "Gradebook unavailable"
                : gb.students.length === 0
                  ? "No students yet"
                  : "Nothing published yet"}
            </EmptyTitle>
            <EmptyDescription>
              {!gb
                ? "Try again in a moment."
                : gb.students.length === 0
                  ? "Enrol students on the People tab."
                  : "Published and closed work shows up here as columns."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const columns = buildColumns(gb.groups, gb.activities);
  const q = search.value.trim().toLowerCase();
  const rows = gb.students
    .filter((r) => showInactive.value || r.status === "active")
    .filter((r) => !q || personName(r).toLowerCase().includes(q))
    .sort((a, b) =>
      `${a.lastName ?? ""} ${a.firstName ?? ""}`.localeCompare(
        `${b.lastName ?? ""} ${b.firstName ?? ""}`,
      ),
    );
  const inactive = gb.students.filter((r) => r.status !== "active").length;

  const counted = rows.filter((r) => r.grade.percent !== null);
  const classAverage = counted.length
    ? counted.reduce((s, r) => s + (r.grade.percent ?? 0), 0) / counted.length
    : null;

  return (
    <div className="space-y-4">
      {header}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Find a student"
            className="w-56 pl-8"
            value={search.value}
            onChange={(e) => (search.value = e.target.value)}
          />
        </div>
        {inactive > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch
              size="sm"
              checked={showInactive.value}
              onCheckedChange={(v) => (showInactive.value = v)}
            />
            Show dropped and completed ({inactive})
          </label>
        )}
        <span className="ml-auto text-sm text-muted-foreground">
          Class average{" "}
          <span className="font-medium text-foreground">
            {formatPercent(classAverage)}
          </span>
        </span>
      </div>

      <div className="relative max-h-[70vh] animate-fade-in-up-delay-1 overflow-auto rounded-lg border">
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20 bg-background">
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 z-30 min-w-48 border-r border-b bg-muted px-3 py-2 text-left font-semibold"
              >
                Student
              </th>
              {columns.map((c) => (
                <th
                  key={c.group.id ?? "ungrouped"}
                  colSpan={c.activities.length}
                  className="border-r border-b bg-muted/60 px-3 py-1.5 text-left text-xs font-semibold"
                >
                  {c.group.name}
                  {c.group.weight !== null && (
                    <span className="ml-1 font-normal text-muted-foreground">
                      {c.group.weight}%
                    </span>
                  )}
                </th>
              ))}
              <th
                rowSpan={2}
                className="sticky right-0 z-30 min-w-28 border-b border-l bg-muted px-3 py-2 text-right font-semibold"
              >
                Total
              </th>
            </tr>
            <tr>
              {columns.flatMap((c) =>
                c.activities.map((a) => (
                  <th
                    key={a.id}
                    className="max-w-36 min-w-24 border-r border-b bg-background px-3 py-1.5 text-left align-bottom font-normal"
                  >
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Link
                            href={`${base}/assignments/${a.id}`}
                            className="line-clamp-2 text-xs font-medium hover:underline"
                          />
                        }
                      >
                        {a.title}
                      </TooltipTrigger>
                      <TooltipContent>
                        {a.title}
                        {a.omitFromFinalGrade && " (not counted)"}
                      </TooltipContent>
                    </Tooltip>
                    <span className="text-[11px] text-muted-foreground">
                      out of {a.points}
                    </span>
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.studentId} className="group">
                <td
                  className={cn(
                    "sticky left-0 z-10 border-r border-b bg-background px-3 py-2 font-medium group-hover:bg-muted",
                    r.status !== "active" && "text-muted-foreground",
                  )}
                >
                  {personName(r)}
                  {r.status !== "active" && (
                    <span className="ml-1.5 text-xs font-normal capitalize">
                      ({r.status})
                    </span>
                  )}
                </td>
                {columns.flatMap((c) =>
                  c.activities.map((a) => (
                    <td
                      key={a.id}
                      className="border-r border-b px-3 py-2 text-center group-hover:bg-muted/50"
                    >
                      <Cell cell={r.cells[a.id]} activity={a} />
                    </td>
                  )),
                )}
                <td className="sticky right-0 z-10 border-b border-l bg-background px-3 py-2 text-right group-hover:bg-muted">
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="cursor-default tabular-nums" />}
                    >
                      <span className="font-semibold">
                        {formatPercent(r.grade.percent)}
                      </span>
                      {r.grade.letter && (
                        <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                          {r.grade.letter}
                        </span>
                      )}
                    </TooltipTrigger>
                    <TooltipContent className="space-y-0.5">
                      {r.grade.groups.length === 0
                        ? "Nothing marked yet"
                        : r.grade.groups.map((g) => (
                            <div key={g.groupId ?? "none"}>
                              {g.name}
                              {g.weight !== null ? ` (${g.weight}%)` : ""}:{" "}
                              {formatPercent(g.percent)}
                            </div>
                          ))}
                    </TooltipContent>
                  </Tooltip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-amber-600 dark:text-amber-500">EX</span>{" "}
          excused
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-sky-500" />
          handed in, not marked
        </span>
        <span>
          <span className="line-through">12</span> omitted from the final grade
        </span>
      </div>
    </div>
  );
}
