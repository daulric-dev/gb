"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { GraduationCap, MessageSquareText } from "lucide-react";
import { api } from "@/lib/api";
import type { PortalCourseGrades } from "@/lib/courses/types";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, kindLabel } from "../../../_components/portal-ui";
import { formatDate, formatPercent } from "../../../_components/types";
import { usePortalCourse } from "../_components/course-context";

type GradeRow = PortalCourseGrades["activities"][number];

export default function PortalCourseGradesPage() {
  useSignals();

  const course = usePortalCourse();
  const data = useSignal<PortalCourseGrades | null>(null);
  const loading = useSignal(true);

  useEffect(() => {
    api<PortalCourseGrades>(`/portal/me/courses/${course.id}/grades`)
      .then((d) => (data.value = d))
      .catch(() => (data.value = null))
      .finally(() => (loading.value = false));
  }, [course.id, data, loading]);

  if (loading.value) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[16rem_1fr]">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data.value) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="Grades unavailable"
        description="We couldn't load your grades for this course. Try again shortly."
      />
    );
  }

  const { grade, activities } = data.value;
  const weighted = grade.groups.some((g) => g.weight !== null && g.weight > 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-[16rem_1fr]">
        <Card>
          <CardHeader>
            <CardDescription>Current grade</CardDescription>
            <CardTitle className="text-4xl font-bold">
              {grade.percent === null ? "-" : formatPercent(grade.percent)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {grade.letter ? (
              <Badge className="text-sm">{grade.letter}</Badge>
            ) : (
              <p className="text-xs text-muted-foreground">
                {grade.percent === null
                  ? "Nothing has been marked yet."
                  : "No letter grade set."}
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Based on marked work only. Ungraded work doesn&apos;t count yet.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Breakdown</CardTitle>
            <CardDescription>
              {weighted
                ? "Each group counts for its share of your grade."
                : "Every point counts equally."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {grade.groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No groups yet.</p>
            ) : (
              grade.groups.map((g) => (
                <div key={g.groupId ?? "ungrouped"} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium">
                      {g.name}
                      {weighted && g.weight !== null && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {g.weight}% of grade
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {g.percent === null ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <>
                          {formatPercent(g.percent)}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {g.earned}/{g.possible}
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${Math.max(0, Math.min(100, g.percent ?? 0))}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assignments</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {activities.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No graded work in this course yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Due</TableHead>
                  <TableHead className="hidden md:table-cell">Status</TableHead>
                  <TableHead className="pr-4 text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activities.map((a) => (
                  <GradeTableRow key={a.id} row={a} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GradeTableRow({ row }: { row: GradeRow }) {
  const s = row.submission;
  const status = s?.excused
    ? "Excused"
    : s?.status === "graded"
      ? "Marked"
      : s?.status === "submitted"
        ? "Handed in"
        : row.kind === "offline"
          ? "On paper"
          : "Not handed in";

  return (
    <>
      <TableRow>
        <TableCell className="max-w-0 pl-4 whitespace-normal">
          <Link
            href={`/portal/work/${row.id}`}
            className="font-medium hover:underline"
          >
            {row.title}
          </Link>
          <p className="text-xs text-muted-foreground">
            {row.groupName ?? "Ungrouped"} · {kindLabel(row.kind)}
          </p>
        </TableCell>
        <TableCell className="hidden text-muted-foreground sm:table-cell">
          {row.dueAt ? formatDate(row.dueAt) : "-"}
        </TableCell>
        <TableCell className="hidden md:table-cell">
          <Badge variant={s?.status === "graded" ? "secondary" : "outline"}>
            {status}
          </Badge>
        </TableCell>
        <TableCell className="pr-4 text-right tabular-nums">
          {s?.excused ? (
            <span className="text-muted-foreground">EX</span>
          ) : s?.status === "graded" && s.score !== null ? (
            <span className="font-medium">
              {s.score}
              <span className="text-muted-foreground">/{row.points}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">-/{row.points}</span>
          )}
        </TableCell>
      </TableRow>
      {s?.feedback && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4} className="max-w-0 pt-0 pl-4 whitespace-normal">
            <div className="flex gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <MessageSquareText className="mt-0.5 size-3.5 shrink-0" />
              <span className="whitespace-pre-wrap">{s.feedback}</span>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
