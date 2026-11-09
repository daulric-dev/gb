"use client";

import { Suspense, useCallback, useEffect } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ArrowLeft } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { personName } from "@/lib/courses/format";
import { statusColor, statusLabel } from "@/lib/attendance";
import {
  ALERT_KIND_LABEL,
  lastWeeks,
  localToday,
  rangeQuery,
  type StudentReport,
} from "@/lib/attendance-reports";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TimeZoneNotice } from "@/components/timetable/time-zone-notice";
import { CsvButton, RangePicker, Rate, TallyLine } from "../../_components/report-ui";

const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** One student's attendance (attendance-report:read, or their form tutor). */
export default function StudentAttendanceReportPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <StudentAttendanceReport />
    </Suspense>
  );
}

function StudentAttendanceReport() {
  useSignals();
  const { studentId } = useParams<{ studentId: string }>();
  const search = useSearchParams();
  const qFrom = search?.get("from") ?? null;
  const qTo = search?.get("to") ?? null;
  const range = useSignal(
    isDate(qFrom) && isDate(qTo) ? { from: qFrom, to: qTo } : lastWeeks(localToday()),
  );
  const report = useSignal<StudentReport | null>(null);
  const error = useSignal<string | null>(null);

  const load = useCallback(async () => {
    try {
      report.value = await api<StudentReport>(
        `/attendance-reports/students/${studentId}?${rangeQuery(range.value)}`,
      );
      error.value = null;
    } catch (err) {
      error.value =
        err instanceof ApiError && err.status === 404
          ? "Student not found, or you cannot see their attendance."
          : userMessage(err, "Could not load the report");
    }
  }, [studentId, range, report, error]);

  useEffect(() => {
    void load();
  }, [load]);

  const r = report.value;
  const q = rangeQuery(range.value);

  return (
    <div className="space-y-6">
      <TimeZoneNotice timeZoneSet={r?.range.timeZoneSet} context="reports" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/dashboard/attendance" />}>
            <ArrowLeft className="mr-1.5 size-4" aria-hidden />
            Attendance
          </Button>
          <h1 className="mt-2 text-3xl font-bold">{r ? personName(r.student) : "Student attendance"}</h1>
        </div>
        <CsvButton
          path={`/attendance-reports/students/${studentId}/export?${q}`}
          fallbackName={`attendance-${range.value.from}-to-${range.value.to}.csv`}
          disabled={!r}
        />
      </div>

      <RangePicker from={range.value.from} to={range.value.to} onChangeAction={(next) => (range.value = next)} />

      {error.value ? (
        <p role="alert" className="text-sm text-destructive">
          {error.value}
        </p>
      ) : !r ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardDescription>Attendance in this range</CardDescription>
              <CardTitle aria-live="polite">
                <Rate t={r.overall} className="text-4xl" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TallyLine t={r.overall} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>By course</CardTitle>
            </CardHeader>
            <CardContent>
              {r.courses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sessions in this range.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Course</TableHead>
                        <TableHead className="text-right">Present</TableHead>
                        <TableHead className="text-right">Late</TableHead>
                        <TableHead className="text-right">Absent</TableHead>
                        <TableHead className="text-right">Excused</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.courses.map((c) => (
                        <TableRow key={c.courseId}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.present}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.late}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.absent}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.excused}</TableCell>
                          <TableCell className="text-right">
                            <Rate t={c} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {r.alerts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Alerts</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y rounded-lg border">
                  {r.alerts.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                      <Badge variant={a.resolvedAt ? "outline" : "destructive"}>{ALERT_KIND_LABEL[a.kind]}</Badge>
                      <span className="flex-1">
                        {a.kind === "low_rate"
                          ? `${a.value}% (below ${a.threshold}%)`
                          : `${a.value} absences in a row`}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(a.openedAt).toLocaleDateString()}
                        {a.resolvedAt ? ` – ${new Date(a.resolvedAt).toLocaleDateString()}` : " · open"}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              {r.records.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sessions in this range.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {r.records.map((x, i) => (
                    <li key={`${x.courseId}-${x.openedAt}-${i}`} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <span className="w-40 shrink-0 tabular-nums text-muted-foreground">
                        {new Date(x.openedAt).toLocaleString(undefined, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{x.courseName}</span>
                      <Badge className={statusColor(x.status)}>{statusLabel(x.status)}</Badge>
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
