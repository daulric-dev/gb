"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  ArrowRight,
  CalendarCheck,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Radio,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { downloadFromUrl } from "@/lib/download";
import type {
  AttendanceCourseSummary,
  AttendanceSession,
} from "@/lib/courses/types";
import { personName } from "@/lib/courses/format";
import {
  formatCountdown,
  formatRate,
  formatSessionDate,
  msUntil,
  rateColor,
  useNow,
} from "@/lib/attendance";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useCourse } from "../_components/course-context";
import { SectionHeader } from "../_components/SectionHeader";
import { CountBadges } from "./_components/attendance-ui";
import { TakeAttendanceDialog } from "./_components/TakeAttendanceDialog";

export default function CourseAttendancePage() {
  useSignals();
  const { course, base } = useCourse();

  const sessions = useSignal<AttendanceSession[] | null>(null);
  const summary = useSignal<AttendanceCourseSummary | null>(null);
  const loading = useSignal(true);
  const exporting = useSignal(false);
  const creating = useSignal(false);

  const load = useCallback(async () => {
    const [s, sum] = await Promise.allSettled([
      api<AttendanceSession[]>(`/courses/${course.id}/attendance/sessions`),
      api<AttendanceCourseSummary>(`/courses/${course.id}/attendance/summary`),
    ]);
    if (s.status === "fulfilled") sessions.value = s.value;
    if (sum.status === "fulfilled") summary.value = sum.value;
    if (s.status === "rejected") toast.error("Failed to load attendance");
    loading.value = false;
  }, [course.id, sessions, summary, loading]);

  useEffect(() => {
    void load();
  }, [load]);

  const now = useNow(1000);
  const openSession =
    sessions.value?.find(
      (s) => s.isOpen && msUntil(s.closesAt, now) > 0,
    ) ?? null;
  const published = course.status === "published";

  async function exportCsv() {
    exporting.value = true;
    try {
      const safe = (course.code || course.name).replace(/[^\w-]+/g, "_");
      await downloadFromUrl(
        `/courses/${course.id}/attendance/export`,
        `${safe}-attendance.csv`,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      exporting.value = false;
    }
  }

  const header = (
    <SectionHeader
      title="Attendance"
      description={
        published
          ? "Open a short check-in window; students check in from their phone or the portal"
          : "Publish the course to take attendance"
      }
      actions={
        openSession ? (
          <Button
            nativeButton={false}
            render={<Link href={`${base}/attendance/${openSession.id}`} />}
          >
            <Radio className="mr-2 size-4 animate-pulse" />
            Open session in progress
            <ArrowRight className="ml-2 size-4" />
            View
          </Button>
        ) : (
          <Button
            onClick={() => (creating.value = true)}
            disabled={!published || loading.value}
            title={published ? undefined : "Publish the course first"}
          >
            <Plus className="mr-2 size-4" />
            Take attendance
          </Button>
        )
      }
    />
  );

  if (loading.value) {
    return (
      <div className="space-y-5">
        {header}
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const list = sessions.value ?? [];
  const students = [...(summary.value?.students ?? [])].sort((a, b) =>
    `${a.lastName ?? ""} ${a.firstName ?? ""}`.localeCompare(
      `${b.lastName ?? ""} ${b.firstName ?? ""}`,
    ),
  );

  return (
    <div className="space-y-6">
      {header}

      {openSession && (
        <Link
          href={`${base}/attendance/${openSession.id}`}
          className="flex animate-fade-in-up items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm transition-colors hover:bg-emerald-500/15"
        >
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="font-medium">
            {openSession.title || "Attendance"} is open
          </span>
          <span className="text-muted-foreground tabular-nums">
            closes in {formatCountdown(msUntil(openSession.closesAt, now))}
          </span>
          <ChevronRight className="ml-auto size-4" />
        </Link>
      )}

      <Card className="animate-fade-in-up-delay-1">
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>
            {list.length === 0
              ? "Nothing taken yet."
              : `${list.length} session${list.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarCheck />
                </EmptyMedia>
                <EmptyTitle>No sessions yet</EmptyTitle>
                <EmptyDescription>
                  {published
                    ? "Press Take attendance at the start of class."
                    : "Publish the course, then take attendance at the start of class."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="divide-y rounded-lg border">
              {list.map((s) => {
                const live = s.isOpen && msUntil(s.closesAt, now) > 0;
                return (
                  <li key={s.id}>
                    <Link
                      href={`${base}/attendance/${s.id}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {formatSessionDate(s.openedAt)}
                        </p>
                        {s.title && (
                          <p className="truncate text-xs text-muted-foreground">
                            {s.title}
                          </p>
                        )}
                      </div>
                      <CountBadges counts={s.counts} showPending={live} />
                      {live ? (
                        <Badge className="border-transparent bg-emerald-500 text-white">
                          Open
                        </Badge>
                      ) : (
                        <Badge variant="outline">Closed</Badge>
                      )}
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="animate-fade-in-up-delay-2">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>By student</CardTitle>
            <CardDescription>
              Rate is present and late over sessions, excused left out
              {summary.value ? ` · ${summary.value.sessionCount} sessions` : ""}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            onClick={exportCsv}
            disabled={exporting.value || list.length === 0}
          >
            {exporting.value ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Download className="mr-2 size-4" />
            )}
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          {students.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {summary.value
                ? "No students enrolled yet."
                : "The summary could not be loaded."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead className="text-right">Present</TableHead>
                    <TableHead className="text-right">Late</TableHead>
                    <TableHead className="text-right">Absent</TableHead>
                    <TableHead className="text-right">Excused</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.map((r) => (
                    <TableRow key={r.studentId}>
                      <TableCell className="font-medium">
                        {personName(r)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.present}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.late}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.absent}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.excused}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-semibold tabular-nums",
                          rateColor(r.rate),
                        )}
                      >
                        {formatRate(r.rate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <TakeAttendanceDialog
        open={creating.value}
        onOpenChangeAction={(v) => (creating.value = v)}
        courseId={course.id}
        base={base}
      />
    </div>
  );
}
