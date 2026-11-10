"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  describeValues,
  lastUpdatedText,
  pct,
  schoolQuery,
  type SchoolAnalytics,
  type SchoolAtRisk,
} from "@/lib/analytics";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ChartCard,
  CsvButton,
  RiskReasons,
  StatTile,
  ValueBarChart,
  studentName,
} from "@/components/analytics/analytics-ui";
import { usePermissions } from "@/providers/PermissionsProvider";
import { AnalyticsSettingsCard } from "./_components/settings-card";

/**
 * School analytics (analytics:read): roll-ups per course and per teacher and
 * the school's students at risk, read from summaries the server refreshes in
 * the background (hourly, or "Refresh now"). Counts and averages only, apart
 * from the at-risk list.
 */
export default function SchoolAnalyticsPage() {
  useSignals();
  const { can, loading: permissionsLoading } = usePermissions();
  const allowed = can("analytics", "read");
  const canEditRules = can("school", "update");
  const yearId = useSignal("");
  const termId = useSignal("");
  const data = useSignal<SchoolAnalytics | null>(null);
  const atRisk = useSignal<SchoolAtRisk | null>(null);
  const loading = useSignal(true);
  const refreshing = useSignal(false);

  const query = schoolQuery({ termId: termId.value, academicYearId: yearId.value });

  const load = useCallback(async () => {
    if (permissionsLoading.value || !allowed) return;
    loading.value = true;
    try {
      const q = query ? `?${query}` : "";
      const [s, r] = await Promise.all([
        api<SchoolAnalytics>(`/analytics/school${q}`),
        api<SchoolAtRisk>(`/analytics/school/at-risk${q}`),
      ]);
      data.value = s;
      atRisk.value = r;
    } catch (err) {
      toast.error(userMessage(err, "Could not load analytics"));
    } finally {
      loading.value = false;
    }
  }, [permissionsLoading.value, allowed, query, data, atRisk, loading]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refreshNow() {
    refreshing.value = true;
    try {
      const r = await api<{ started: boolean }>(`/analytics/school/refresh`, { method: "POST" });
      toast.success(
        r.started
          ? "Refreshing. The figures update in a minute or so."
          : "A refresh is already running or just finished.",
      );
      if (r.started) setTimeout(() => void load(), 8000);
    } catch (err) {
      toast.error(userMessage(err, "Could not start a refresh"));
    } finally {
      refreshing.value = false;
    }
  }

  if (permissionsLoading.value) return <Skeleton className="h-72 w-full" />;
  if (!allowed) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader title="Analytics" description="School analytics need the analytics permission." />
        <p className="text-sm text-muted-foreground">
          Ask an administrator for the &ldquo;View school analytics&rdquo; permission. Each course&rsquo;s own analytics are on its Analytics tab.
        </p>
      </div>
    );
  }

  const s = data.value;
  const terms = (s?.filters.terms ?? []).filter((t) => !yearId.value || t.academic_year_id === yearId.value);
  const exportBase = `/analytics/school/export?${query}${query ? "&" : ""}table=`;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Analytics"
        description="Grades, submissions, attendance and students at risk across the school's courses."
        action={
          <Button variant="outline" onClick={() => void refreshNow()} disabled={refreshing.value}>
            {refreshing.value ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-2 size-4" aria-hidden />}
            Refresh now
          </Button>
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
          <div className="space-y-1.5">
            <Label htmlFor="filter-year">Academic year</Label>
            <NativeSelect
              id="filter-year"
              value={yearId.value}
              onChange={(e) => {
                yearId.value = e.target.value;
                termId.value = "";
              }}
            >
              <NativeSelectOption value="">All years</NativeSelectOption>
              {(s?.filters.academicYears ?? []).map((y) => (
                <NativeSelectOption key={y.id} value={y.id}>
                  {y.name ?? "Unnamed year"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filter-term">Term</Label>
            <NativeSelect id="filter-term" value={termId.value} onChange={(e) => (termId.value = e.target.value)}>
              <NativeSelectOption value="">All terms</NativeSelectOption>
              {terms.map((t) => (
                <NativeSelectOption key={t.id} value={t.id}>
                  {t.name ?? "Unnamed term"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {s ? lastUpdatedText(s.lastUpdated) : ""}
        </p>
      </div>

      {!s ? (
        loading.value ? <Skeleton className="h-72 w-full" /> : <p className="text-sm text-muted-foreground">Analytics could not be loaded.</p>
      ) : (
        <>
          <section aria-label="School totals" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Courses" value={String(s.totals.courses)} />
            <StatTile label="Enrolments" value={String(s.totals.enrolments)} />
            <StatTile label="Average grade" value={pct(s.totals.averageGrade)} />
            <StatTile label="Submission rate" value={pct(s.totals.submissionRate)} hint={`${s.totals.missing} missing`} />
            <StatTile label="Attendance" value={pct(s.totals.attendanceRate)} hint="Recent weeks" />
            <StatTile label="Students at risk" value={String(s.totals.atRiskStudents)} hint={`${s.totals.atRisk} in courses`} />
          </section>

          <ChartCard
            level={2}
            title="Courses"
            description="Average grade, submission rate, attendance and at-risk count per course."
            summary={describeValues(s.courses.map((c) => ({ name: c.name, value: c.averageGrade })), "average grade")}
            empty={s.courses.length === 0 ? "No courses in this selection yet." : null}
            actions={<CsvButton path={`${exportBase}courses`} fallbackName="school-analytics-courses.csv" label="courses" />}
            chart={
              <ValueBarChart
                label="Average grade %"
                unit="%"
                max={100}
                data={s.courses.map((c) => ({ name: c.code || c.name, value: c.averageGrade }))}
              />
            }
            table={
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Course</TableHead>
                    <TableHead>Teachers</TableHead>
                    <TableHead className="text-right">Students</TableHead>
                    <TableHead className="text-right">Average</TableHead>
                    <TableHead className="text-right">Submission rate</TableHead>
                    <TableHead className="text-right">Attendance</TableHead>
                    <TableHead className="text-right">At risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.courses.map((c) => (
                    <TableRow key={c.courseId}>
                      <TableCell className="font-medium">
                        <Link className="underline-offset-2 hover:underline" href={`/dashboard/courses/${c.courseId}/analytics`}>
                          {c.name}
                        </Link>
                      </TableCell>
                      <TableCell>{c.teachers.join(", ") || "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.enrolments}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(c.averageGrade)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(c.submissionRate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(c.attendanceRate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.atRisk}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
          />

          <ChartCard
            level={2}
            title="Teachers"
            description="Each teacher's courses together (counts summed, then divided: a large course weighs more)."
            summary={describeValues(s.teachers.map((t) => ({ name: t.name, value: t.averageGrade })), "average grade")}
            empty={s.teachers.length === 0 ? "No teachers in this selection yet." : null}
            actions={<CsvButton path={`${exportBase}teachers`} fallbackName="school-analytics-teachers.csv" label="teachers" />}
            chart={
              <ValueBarChart
                label="Average grade %"
                unit="%"
                max={100}
                data={s.teachers.map((t) => ({ name: t.name, value: t.averageGrade }))}
              />
            }
            table={
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Teacher</TableHead>
                    <TableHead className="text-right">Courses</TableHead>
                    <TableHead className="text-right">Enrolments</TableHead>
                    <TableHead className="text-right">Average</TableHead>
                    <TableHead className="text-right">Submission rate</TableHead>
                    <TableHead className="text-right">Attendance</TableHead>
                    <TableHead className="text-right">At risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.teachers.map((t) => (
                    <TableRow key={t.teacherId}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.courses}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.enrolments}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(t.averageGrade)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(t.submissionRate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(t.attendanceRate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.atRisk}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
          />

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>
                  <h2>Students at risk</h2>
                </CardTitle>
                <CardDescription>
                  One row per student and course, from the last refresh, with the reasons. Visible only with the analytics permission.
                </CardDescription>
              </div>
              <CsvButton path={`${exportBase}at-risk`} fallbackName="school-analytics-at-risk.csv" label="students at risk" />
            </CardHeader>
            <CardContent>
              {!atRisk.value || atRisk.value.students.length === 0 ? (
                <p className="text-sm text-muted-foreground">No students match the rules.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead>Course</TableHead>
                        <TableHead className="text-right">Grade</TableHead>
                        <TableHead className="text-right">Missing</TableHead>
                        <TableHead className="text-right">Attendance</TableHead>
                        <TableHead>Reasons</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {atRisk.value.students.map((r) => (
                        <TableRow key={`${r.courseId}:${r.studentId}`}>
                          <TableCell className="font-medium">{studentName(r)}</TableCell>
                          <TableCell>{r.courseName}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(r.grade)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.missingRecent}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(r.attendanceRate)}</TableCell>
                          <TableCell>
                            <RiskReasons reasons={r.reasons} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {canEditRules && <AnalyticsSettingsCard onSavedAction={() => void refreshNow()} />}
        </>
      )}
    </div>
  );
}
