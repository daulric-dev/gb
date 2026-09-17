"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "@/lib/api";
import {
  getClassTermResults,
  termResultsToClassSummary,
  type StudentTermResult,
} from "@/lib/reports/calculations";
import type { ClassSummary } from "@/lib/reports/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  TrendingUp,
  Users,
} from "lucide-react";
import { StatCard } from "./StatCard";

interface ClassItem {
  id: string;
  name: string | null;
  academicYearId: string | null;
  isClassTeacher: boolean | null;
}

interface ActiveYear {
  id: string;
  name: string;
  grading_model: string;
}

interface Term {
  id: string;
  academic_year_id: string;
  name: "michaelmas" | "hilary" | "trinity";
  start_date: string;
  end_date: string;
  exam_weight: number;
  coursework_weight: number;
  sort_order: number;
}

interface ClassReport {
  classId: string;
  className: string;
  isClassTeacher: boolean;
  studentCount: number;
  summary: ClassSummary | null;
  results: StudentTermResult[];
}

const PASS_THRESHOLD = 50;

function formatPct(value: number | null): string {
  if (value == null) return "-";
  return `${value.toFixed(1)}%`;
}

function pickCurrentTerm(terms: Term[]): Term | null {
  if (terms.length === 0) return null;
  const today = Date.now();

  const inProgress = terms.find((t) => {
    const start = new Date(t.start_date).getTime();
    const end = new Date(t.end_date).getTime();
    return start <= today && today <= end;
  });
  if (inProgress) return inProgress;

  const started = terms
    .filter((t) => new Date(t.start_date).getTime() <= today)
    .sort(
      (a, b) =>
        new Date(b.start_date).getTime() - new Date(a.start_date).getTime(),
    );
  if (started.length > 0) return started[0];

  return [...terms].sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;
}

function aggregateSubjectAverages(
  reports: ClassReport[],
): { subject: string; average: number }[] {
  const totals = new Map<string, { name: string; sum: number; count: number }>();

  for (const report of reports) {
    for (const sa of report.summary?.subjectAverages ?? []) {
      if (sa.average == null) continue;
      const entry = totals.get(sa.subjectId) ?? {
        name: sa.subjectName,
        sum: 0,
        count: 0,
      };
      entry.sum += sa.average;
      entry.count += 1;
      totals.set(sa.subjectId, entry);
    }
  }

  return [...totals.values()]
    .map((e) => ({ subject: e.name, average: e.sum / e.count }))
    .sort((a, b) => b.average - a.average);
}

function ClassCard({
  report,
  termName,
}: {
  report: ClassReport;
  termName: string | null;
}) {
  const summary = report.summary;
  const passRate =
    summary && summary.totalStudents > 0
      ? (summary.passCount / summary.totalStudents) * 100
      : null;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">
              {report.className}
            </CardTitle>
            <CardDescription className="text-xs">
              {termName ? `${termName} term` : "Current term"}
            </CardDescription>
          </div>
          {report.isClassTeacher && (
            <Badge variant="secondary" className="shrink-0">
              Class Teacher
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-lg font-semibold">{report.studentCount}</p>
            <p className="text-xs text-muted-foreground">Students</p>
          </div>
          <div>
            <p className="text-lg font-semibold">
              {formatPct(summary?.classAverage ?? null)}
            </p>
            <p className="text-xs text-muted-foreground">Average</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{formatPct(passRate)}</p>
            <p className="text-xs text-muted-foreground">Pass Rate</p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="mt-auto w-full"
          render={
            <Link href={`/dashboard/classes/${report.classId}`}>
              Open class
              <ArrowRight className="ml-1.5 size-3.5" />
            </Link>
          }
        />
      </CardContent>
    </Card>
  );
}

function ChartSkeleton() {
  return <Skeleton className="h-64 w-full" />;
}

export function TeacherDashboard({ classes }: { classes: ClassItem[] }) {
  useSignals();

  const activeYear = useSignal<ActiveYear | null>(null);
  const currentTerm = useSignal<Term | null>(null);
  const reports = useSignal<ClassReport[]>([]);
  const loading = useSignal(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      loading.value = true;
      try {
        const year = await api<ActiveYear | null>(
          "/academic-years/active",
        ).catch(() => null);

        if (cancelled) return;
        activeYear.value = year;

        let term: Term | null = null;
        if (year) {
          const terms = await api<Term[]>(`/terms?yearId=${year.id}`).catch(
            () => [] as Term[],
          );
          term = pickCurrentTerm(terms);
        }

        if (cancelled) return;
        currentTerm.value = term;

        if (classes.length === 0) {
          reports.value = [];
          return;
        }

        const built = await Promise.all(
          classes.map(async (c) => {
            const [results, students] = await Promise.all([
              term
                ? getClassTermResults(term.id, c.id).catch(
                    () => [] as StudentTermResult[],
                  )
                : Promise.resolve([] as StudentTermResult[]),
              api<{ id: string }[]>(`/classes/${c.id}/students`).catch(
                () => [] as { id: string }[],
              ),
            ]);

            const summary = term
              ? termResultsToClassSummary(results, {
                  courseworkWeight: term.coursework_weight,
                  examWeight: term.exam_weight,
                  gradingModel: year?.grading_model,
                })
              : null;

            const report: ClassReport = {
              classId: c.id,
              className: c.name ?? "Untitled class",
              isClassTeacher: c.isClassTeacher === true,
              studentCount: students.length,
              summary,
              results,
            };
            return report;
          }),
        );

        if (cancelled) return;
        reports.value = built;
      } catch {
        if (!cancelled) toast.error("Failed to load dashboard data");
      } finally {
        if (!cancelled) loading.value = false;
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [classes]);

  if (classes.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <BookOpen className="mb-3 size-10 text-muted-foreground/40" />
          <p className="font-medium">You haven&apos;t been assigned any classes yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Once an admin assigns you to a class, your students will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totals = reports.value.reduce(
    (acc, r) => {
      acc.students += r.studentCount;
      if (r.summary) {
        acc.passCount += r.summary.passCount;
        acc.gradedStudents += r.summary.totalStudents;
        if (r.summary.classAverage != null) {
          acc.avgSum += r.summary.classAverage;
          acc.avgN += 1;
        }
      }
      return acc;
    },
    { students: 0, avgSum: 0, avgN: 0, passCount: 0, gradedStudents: 0 },
  );

  const averageThisTerm = totals.avgN > 0 ? totals.avgSum / totals.avgN : null;
  const passRate =
    totals.gradedStudents > 0
      ? (totals.passCount / totals.gradedStudents) * 100
      : null;

  const subjectAverages = aggregateSubjectAverages(reports.value);

  const chartConfig: ChartConfig = {
    average: {
      label: "Average",
      color: "var(--color-primary)",
    },
  };

  const termSubtitle = activeYear.value
    ? currentTerm.value
      ? `${activeYear.value.name} · ${currentTerm.value.name.charAt(0).toUpperCase() + currentTerm.value.name.slice(1)} term`
      : `${activeYear.value.name} · No active term`
    : "No active academic year";

  return (
    <div className="space-y-8">
      <p className="animate-fade-in-up text-muted-foreground">
        Overview of your students for {termSubtitle}.
      </p>

      <div className="grid animate-fade-in-up-delay-1 grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={BookOpen}
          value={classes.length}
          label="My Classes"
        />
        <StatCard icon={Users} value={totals.students} label="Total Students" />
        <StatCard
          icon={TrendingUp}
          value={formatPct(averageThisTerm)}
          label="Average This Term"
          loading={loading.value}
        />
        <StatCard
          icon={CheckCircle2}
          value={formatPct(passRate)}
          label="Pass Rate"
          loading={loading.value}
        />
      </div>

      <Card className="animate-fade-in-up-delay-2">
        <CardHeader>
          <CardTitle>Subject Performance</CardTitle>
          <CardDescription>
            Average score per subject across your classes (pass mark{" "}
            {PASS_THRESHOLD}%).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading.value ? (
            <ChartSkeleton />
          ) : subjectAverages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No grades recorded for this term yet.
            </p>
          ) : (
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <BarChart
                data={subjectAverages}
                margin={{ top: 8, right: 8, left: -16, bottom: 8 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="subject"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                  interval={0}
                  angle={-15}
                  height={48}
                  textAnchor="end"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}`}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) =>
                        typeof value === "number"
                          ? `${value.toFixed(1)}%`
                          : `${value}`
                      }
                    />
                  }
                />
                <ReferenceLine
                  y={PASS_THRESHOLD}
                  stroke="var(--color-muted-foreground)"
                  strokeDasharray="3 3"
                />
                <Bar
                  dataKey="average"
                  fill="var(--color-average)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3 animate-fade-in-up-delay-2">
        <h2 className="text-lg font-semibold">My Classes</h2>
        {loading.value ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classes.map((c) => (
              <Skeleton key={c.id} className="h-44 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {reports.value.map((report) => (
              <ClassCard
                key={report.classId}
                report={report}
                termName={
                  currentTerm.value
                    ? currentTerm.value.name.charAt(0).toUpperCase() +
                      currentTerm.value.name.slice(1)
                    : null
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
