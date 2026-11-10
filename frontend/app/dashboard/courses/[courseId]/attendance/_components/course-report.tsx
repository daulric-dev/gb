"use client";

import { useCallback, useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { personName } from "@/lib/courses/format";
import { useFeatures } from "@/hooks/use-features";
import {
  ALERT_KIND_LABEL,
  byRateThenName,
  lastWeeks,
  localToday,
  rangeQuery,
  type CourseReport,
} from "@/lib/attendance-reports";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TimeZoneNotice } from "@/components/timetable/time-zone-notice";
import { CsvButton, RangePicker, Rate, TallyLine } from "@/app/dashboard/attendance/_components/report-ui";

/**
 * The course's attendance over a date range (GET /courses/:id/attendance-report),
 * lowest first, with open alerts; only while `attendance_alerts` is on.
 */
export function CourseAttendanceReport({ courseId, fileBase }: { courseId: string; fileBase: string }) {
  useSignals();
  const { hasFeature } = useFeatures();
  const on = hasFeature("attendance_alerts");
  const range = useSignal(lastWeeks(localToday()));
  const report = useSignal<CourseReport | null>(null);
  const error = useSignal<string | null>(null);

  const load = useCallback(async () => {
    if (!on) return;
    try {
      report.value = await api<CourseReport>(`/courses/${courseId}/attendance-report?${rangeQuery(range.value)}`);
      error.value = null;
    } catch (err) {
      error.value = userMessage(err, "Could not load the report");
    }
  }, [on, courseId, range, report, error]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!on) return null;
  const r = report.value;
  const q = rangeQuery(range.value);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
        <div className="space-y-3">
          <div>
            <CardTitle>Report by date</CardTitle>
            <CardDescription>Attendance over a chosen range; students with an open alert are marked.</CardDescription>
          </div>
          <RangePicker from={range.value.from} to={range.value.to} onChangeAction={(next) => (range.value = next)} />
        </div>
        <CsvButton
          path={`/courses/${courseId}/attendance-report/export?${q}`}
          fallbackName={`${fileBase}-attendance-${range.value.from}-to-${range.value.to}.csv`}
          disabled={!r}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <TimeZoneNotice timeZoneSet={r?.range.timeZoneSet} context="reports" />
        {error.value ? (
          <p role="alert" className="text-sm text-destructive">
            {error.value}
          </p>
        ) : !r ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-3" aria-live="polite">
              <Rate t={r.overall} className="text-2xl" />
              <TallyLine t={r.overall} />
              <span className="text-sm text-muted-foreground">· {r.sessions} sessions</span>
            </div>
            {r.students.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sessions in this range.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead className="text-right">Absent</TableHead>
                      <TableHead className="text-right">Late</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...r.students].sort(byRateThenName).map((s) => (
                      <TableRow key={s.studentId}>
                        <TableCell className="font-medium">
                          <span className="flex flex-wrap items-center gap-2">
                            {personName(s)}
                            {s.openAlerts.map((k) => (
                              <Badge key={k} variant="destructive">
                                {ALERT_KIND_LABEL[k as keyof typeof ALERT_KIND_LABEL] ?? k}
                              </Badge>
                            ))}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{s.absent}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.late}</TableCell>
                        <TableCell className="text-right">
                          <Rate t={s} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
