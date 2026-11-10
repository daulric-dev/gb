"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { rateColor } from "@/lib/attendance";
import { countedSessions, formatPercent, type PortalAttendanceSummary } from "@/lib/attendance-reports";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** The student's own attendance percentage, overall and per course. */
export default function PortalAttendancePage() {
  useSignals();
  const data = useSignal<PortalAttendanceSummary | null>(null);
  const error = useSignal<string | null>(null);

  useEffect(() => {
    api<PortalAttendanceSummary>("/portal/me/attendance/summary")
      .then((s) => (data.value = s))
      .catch((err) => (error.value = userMessage(err, "Could not load your attendance")));
  }, [data, error]);

  const s = data.value;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Attendance</h1>
        <p className="mt-1 text-muted-foreground">
          Present and late count as attended; excused sessions are left out.
        </p>
      </div>
      {error.value ? (
        <p role="alert" className="text-sm text-destructive">
          {error.value}
        </p>
      ) : !s ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardDescription>Overall attendance</CardDescription>
              <CardTitle className={cn("text-4xl font-bold tabular-nums", rateColor(s.overall.rate))}>
                {formatPercent(s.overall.rate)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {countedSessions(s.overall) === 0
                ? "No sessions recorded yet."
                : `${s.overall.present} present · ${s.overall.late} late · ${s.overall.absent} absent · ${s.overall.excused} excused`}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>By course</CardTitle>
            </CardHeader>
            <CardContent>
              {s.courses.length === 0 ? (
                <p className="text-sm text-muted-foreground">You are not in any courses yet.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {s.courses.map((c) => (
                    <li key={c.courseId}>
                      <Link
                        href={`/portal/courses/${c.courseId}/attendance`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {c.courseName}
                            {c.archived && <span className="text-muted-foreground"> (archived)</span>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {c.summary.present + c.summary.late} of {countedSessions(c.summary)} sessions attended
                          </p>
                        </div>
                        <span className={cn("text-sm font-semibold tabular-nums", rateColor(c.summary.rate))}>
                          {formatPercent(c.summary.rate)}
                        </span>
                        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
