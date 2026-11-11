"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { BellRing, Check, ChevronRight } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { personName } from "@/lib/courses/format";
import {
  ALERT_KIND_LABEL,
  byRateThenName,
  lastWeeks,
  localToday,
  rangeQuery,
  type AlertList,
  type SchoolReport,
} from "@/lib/attendance-reports";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TimeZoneNotice } from "@/components/timetable/time-zone-notice";
import { usePermissions } from "@/providers/PermissionsProvider";
import { CsvButton, RangePicker, Rate, TallyLine } from "./_components/report-ui";
import { AlertSettingsCard } from "./_components/alert-settings";
import { FormTutorsCard } from "./_components/form-tutors";
import { NoTranslate } from "@/components/translation/no-translate";

const forbidden = (err: unknown) => err instanceof ApiError && err.status === 403;

/**
 * Attendance reports and alerts. Everyone on staff sees the alerts they may
 * (all with attendance-report:read, else their tutees'); the school report
 * needs attendance-report:read, and alert settings and form tutors appear
 * only when the API allows them.
 */
export default function AttendanceReportsPage() {
  useSignals();
  const range = useSignal(lastWeeks(localToday()));
  const report = useSignal<SchoolReport | null>(null);
  const reportState = useSignal<"loading" | "ok" | "forbidden" | "error">("loading");
  const alerts = useSignal<AlertList | null>(null);
  const alertStatus = useSignal<"open" | "resolved">("open");
  const { can, loading: permissionsLoading } = usePermissions();
  const waitingForPermissions = permissionsLoading.value;
  const canSeeReport = can("attendance-report", "read");

  const loadReport = useCallback(async () => {
    if (waitingForPermissions) return;
    // The school report has its own permission; tutors only see alerts here.
    if (!canSeeReport) {
      reportState.value = "forbidden";
      return;
    }
    reportState.value = "loading";
    try {
      report.value = await api<SchoolReport>(`/attendance-reports/school?${rangeQuery(range.value)}`);
      reportState.value = "ok";
    } catch (err) {
      reportState.value = forbidden(err) ? "forbidden" : "error";
      if (!forbidden(err)) toast.error(userMessage(err, "Could not load the report"));
    }
  }, [range, report, reportState, waitingForPermissions, canSeeReport]);

  const loadAlerts = useCallback(async () => {
    try {
      alerts.value = await api<AlertList>(`/attendance-alerts?status=${alertStatus.value}`);
    } catch (err) {
      toast.error(userMessage(err, "Could not load alerts"));
    }
  }, [alerts, alertStatus]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);
  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  async function acknowledge(id: string) {
    try {
      await api(`/attendance-alerts/${id}/acknowledge`, { method: "POST" });
      await loadAlerts();
    } catch (err) {
      toast.error(userMessage(err, "Could not acknowledge the alert"));
    }
  }

  const r = report.value;
  const q = rangeQuery(range.value);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Attendance"
        description="Attendance percentages over a date range, and alerts when students fall below the school's thresholds."
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="size-5" aria-hidden />
              Alerts
            </CardTitle>
            <CardDescription>
              {alerts.value?.canSeeSchool
                ? "Every student in the school."
                : "Students you are form tutor for."}{" "}
              An alert stays open until the student recovers; it is not repeated meanwhile.
            </CardDescription>
          </div>
          <Tabs
            value={alertStatus.value}
            onValueChange={(v) => {
              alertStatus.value = v as "open" | "resolved";
              void loadAlerts();
            }}
          >
            <TabsList>
              <TabsTrigger value="open">Open</TabsTrigger>
              <TabsTrigger value="resolved">Resolved</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {!alerts.value ? (
            <Skeleton className="h-20 w-full" />
          ) : alerts.value.alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {alertStatus.value === "open" ? "No open alerts." : "No resolved alerts."}
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {alerts.value.alerts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/dashboard/attendance/students/${a.studentId}`}
                      className="text-sm font-medium underline-offset-2 hover:underline"
                      translate="no"
                    >
                      {personName(a)}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {a.description} Since {new Date(a.openedAt).toLocaleDateString()}
                      {a.resolvedAt ? ` · resolved ${new Date(a.resolvedAt).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline">{ALERT_KIND_LABEL[a.kind]}</Badge>
                  {a.mine && <Badge variant="secondary">Your tutee</Badge>}
                  {!a.resolvedAt &&
                    (a.acknowledgedAt ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Check className="size-3.5" aria-hidden /> Seen
                      </span>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => void acknowledge(a.id)}>
                        Mark as seen
                      </Button>
                    ))}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {reportState.value !== "forbidden" && <TimeZoneNotice timeZoneSet={r?.range.timeZoneSet} context="reports" />}

      {reportState.value !== "forbidden" && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
            <div className="space-y-3">
              <div>
                <CardTitle>School report</CardTitle>
                <CardDescription>
                  Present and late count as attended; excused sessions are left out. Students are only counted for sessions they have a record in.
                </CardDescription>
              </div>
              <RangePicker
                from={range.value.from}
                to={range.value.to}
                onChangeAction={(next) => (range.value = next)}
              />
            </div>
            <CsvButton
              path={`/attendance-reports/school/export?${q}`}
              fallbackName={`attendance-${range.value.from}-to-${range.value.to}.csv`}
              disabled={!r}
            />
          </CardHeader>
          <CardContent className="space-y-6">
            {reportState.value === "loading" && !r ? (
              <Skeleton className="h-48 w-full" />
            ) : !r ? (
              <p className="text-sm text-muted-foreground">The report could not be loaded.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-4" aria-live="polite">
                  <Rate t={r.overall} className="text-4xl" />
                  <TallyLine t={r.overall} />
                  <span className="text-sm text-muted-foreground">· {r.sessions} sessions</span>
                </div>

                <section aria-labelledby="by-course" className="space-y-2">
                  <h3 id="by-course" className="text-sm font-semibold">By course</h3>
                  {r.courses.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No sessions in this range.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Course</TableHead>
                            <TableHead className="text-right">Students</TableHead>
                            <TableHead className="text-right">Absent</TableHead>
                            <TableHead className="text-right">Rate</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {r.courses.map((c) => (
                            <TableRow key={c.courseId}>
                              <TableCell className="font-medium">
                                <Link
                                  href={`/dashboard/courses/${c.courseId}/attendance`}
                                  className="underline-offset-2 hover:underline"
                                >
                                  {c.name}
                                </Link>
                                {c.code && <span className="text-muted-foreground"> · {c.code}</span>}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{c.students}</TableCell>
                              <TableCell className="text-right tabular-nums">{c.absent}</TableCell>
                              <TableCell className="text-right">
                                <Rate t={c} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </section>

                <section aria-labelledby="by-student" className="space-y-2">
                  <h3 id="by-student" className="text-sm font-semibold">By student (lowest first)</h3>
                  {r.students.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No students with records in this range.</p>
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
                            <TableHead><span className="sr-only">Open</span></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[...r.students].sort(byRateThenName).map((s) => (
                            <TableRow key={s.studentId}>
                              <TableCell className="font-medium">
                                <span className="flex flex-wrap items-center gap-2">
                                  <NoTranslate>{personName(s)}</NoTranslate>
                                  {s.openAlerts.map((k) => (
                                    <Badge key={k} variant="destructive">
                                      {ALERT_KIND_LABEL[k as keyof typeof ALERT_KIND_LABEL] ?? k}
                                    </Badge>
                                  ))}
                                </span>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{s.present}</TableCell>
                              <TableCell className="text-right tabular-nums">{s.late}</TableCell>
                              <TableCell className="text-right tabular-nums">{s.absent}</TableCell>
                              <TableCell className="text-right tabular-nums">{s.excused}</TableCell>
                              <TableCell className="text-right">
                                <Rate t={s} />
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`Open ${personName(s)}'s report`}
                                  data-private-label
                                  nativeButton={false}
                                  render={<Link href={`/dashboard/attendance/students/${s.studentId}?${q}`} />}
                                >
                                  <ChevronRight className="size-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </section>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <AlertSettingsCard />
      <FormTutorsCard />
    </div>
  );
}
