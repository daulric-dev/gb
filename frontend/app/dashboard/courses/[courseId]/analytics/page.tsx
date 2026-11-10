"use client";

import { useCallback, useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  describeDistribution,
  describeSubmissions,
  describeTrend,
  describeValues,
  histogramRows,
  pct,
  type CourseAnalytics,
} from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ChartCard,
  CsvButton,
  RiskReasons,
  StatTile,
  TrendLineChart,
  ValueBarChart,
  studentName,
} from "@/components/analytics/analytics-ui";
import { useCourse } from "../_components/course-context";
import { SectionHeader } from "../_components/SectionHeader";

/**
 * A course's analytics, computed for this one course when the page loads:
 * submission rates per activity, grade distributions, group averages, the
 * weekly trend and students at risk (with reasons). Every chart has a text
 * summary and a table.
 */
export default function CourseAnalyticsPage() {
  useSignals();
  const { course } = useCourse();
  const data = useSignal<CourseAnalytics | null>(null);
  const loading = useSignal(true);

  const load = useCallback(async () => {
    loading.value = true;
    try {
      data.value = await api<CourseAnalytics>(`/courses/${course.id}/analytics`);
    } catch (err) {
      toast.error(userMessage(err, "Could not load analytics"));
    } finally {
      loading.value = false;
    }
  }, [course.id, data, loading]);

  useEffect(() => {
    void load();
  }, [load]);

  const v = data.value;
  const base = `/courses/${course.id}/analytics/export`;
  const file = (t: string) => `${course.code || course.name}-analytics-${t}.csv`;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Analytics"
        description="Submission rates, grade distributions and students who may need support. Marks count once graded; late penalties are included."
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={loading.value}>
            <RefreshCw className="mr-2 size-4" aria-hidden />
            Refresh
          </Button>
        }
      />

      {!v ? (
        loading.value ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <p className="text-sm text-muted-foreground">Analytics could not be loaded.</p>
        )
      ) : (
        <>
          <section aria-label="Overview" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile label="Students" value={String(v.students)} />
            <StatTile label="Average grade" value={pct(v.overview.averageGrade)} hint={`Median ${pct(v.overview.medianGrade)}`} />
            <StatTile
              label="Submission rate"
              value={pct(v.overview.submission.rate)}
              hint={`${v.overview.submission.late} late · ${v.overview.submission.missing} missing`}
            />
            {v.features.attendance && (
              <StatTile label="Attendance" value={pct(v.overview.attendanceRate)} hint={`Last ${v.rules.windowWeeks} weeks`} />
            )}
            <StatTile label="At risk" value={String(v.overview.atRisk)} hint="See the list below" />
          </section>

          <AtRiskCard v={v} csv={<CsvButton path={`${base}?table=at-risk`} fallbackName={file("at-risk")} label="students at risk" />} />

          <ChartCard
            title="Submissions per activity"
            description="Handed in (on time or late) out of handed in plus missing. Work not yet due and excused students are left out; offline work is never missing."
            summary={describeSubmissions(v.activities)}
            empty={v.activities.length === 0 ? "No published work yet." : null}
            actions={<CsvButton path={`${base}?table=activities`} fallbackName={file("activities")} label="activities" />}
            chart={
              <ValueBarChart
                label="Submission rate %"
                unit="%"
                max={100}
                data={v.activities.map((a) => ({ name: a.title, value: a.rate }))}
              />
            }
            table={
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Activity</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">On time</TableHead>
                    <TableHead className="text-right">Late</TableHead>
                    <TableHead className="text-right">Missing</TableHead>
                    <TableHead className="text-right">Not yet due</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Median mark</TableHead>
                    <TableHead className="text-right">Middle half</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {v.activities.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.title}</TableCell>
                      <TableCell>{a.dueAt ? new Date(a.dueAt).toLocaleDateString() : "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.onTime}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.late}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.missing}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.pending}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(a.rate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(a.distribution.median)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.distribution.count ? `${pct(a.distribution.q1)} – ${pct(a.distribution.q3)}` : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
          />

          <ChartCard
            title="Course grade distribution"
            description="Students' current grades in 10-point bands, with median and quartiles."
            summary={describeDistribution(v.gradeDistribution)}
            empty={v.gradeDistribution.count === 0 ? "No grades yet." : null}
            actions={<CsvButton path={`${base}?table=distribution`} fallbackName={file("distribution")} label="grade distribution" />}
            chart={
              <ValueBarChart
                label="Students"
                data={histogramRows(v.gradeDistribution).map((r) => ({ name: r.label, value: r.count }))}
              />
            }
            table={<HistogramTable rows={histogramRows(v.gradeDistribution)} />}
          />

          <ActivityDistribution v={v} />

          <ChartCard
            title="Average by assignment group"
            description="The mean of students' percentages in each group, over students with marked work there."
            summary={describeValues(
              v.groups.map((g) => ({ name: g.name, value: g.average })),
              "group average",
            )}
            empty={v.groups.length === 0 ? "No assignment groups." : null}
            actions={<CsvButton path={`${base}?table=groups`} fallbackName={file("groups")} label="group averages" />}
            chart={
              <ValueBarChart
                label="Average %"
                unit="%"
                max={100}
                data={v.groups.map((g) => ({ name: g.name, value: g.average }))}
              />
            }
            table={
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="text-right">Average</TableHead>
                    <TableHead className="text-right">Students</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {v.groups.map((g) => (
                    <TableRow key={g.groupId ?? "ungrouped"}>
                      <TableCell className="font-medium">{g.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{g.weight ?? "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(g.average)}</TableCell>
                      <TableCell className="text-right tabular-nums">{g.students}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
          />

          <ChartCard
            title="Weekly trend"
            description="Average mark per week, by the week each piece of work was due (else handed in or marked)."
            summary={describeTrend(v.trend)}
            empty={v.trend.length === 0 ? "No marks yet." : null}
            actions={<CsvButton path={`${base}?table=trend`} fallbackName={file("trend")} label="weekly trend" />}
            chart={<TrendLineChart data={v.trend} />}
            table={
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Week of</TableHead>
                    <TableHead className="text-right">Average</TableHead>
                    <TableHead className="text-right">Marks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {v.trend.map((t) => (
                    <TableRow key={t.week}>
                      <TableCell>{t.week}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(t.average)}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
          />
        </>
      )}
    </div>
  );
}

function HistogramTable({ rows }: { rows: { label: string; count: number }[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Band (%)</TableHead>
          <TableHead className="text-right">Count</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.label}>
            <TableCell>{r.label}</TableCell>
            <TableCell className="text-right tabular-nums">{r.count}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** One activity's mark distribution, picked from a list. */
function ActivityDistribution({ v }: { v: CourseAnalytics }) {
  useSignals();
  const marked = v.activities.filter((a) => a.distribution.count > 0);
  const chosen = useSignal<string>(marked[0]?.id ?? "");
  const a = marked.find((x) => x.id === chosen.value) ?? marked[0];
  if (!a) return null;
  return (
    <ChartCard
      title="Marks for one activity"
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Label htmlFor="activity-dist">Activity</Label>
          <NativeSelect id="activity-dist" value={a.id} onChange={(e) => (chosen.value = e.target.value)}>
            {marked.map((x) => (
              <NativeSelectOption key={x.id} value={x.id}>
                {x.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </span>
      }
      summary={`${a.title}: ${describeDistribution(a.distribution, "marks")}`}
      chart={
        <ValueBarChart
          label="Marks"
          data={histogramRows(a.distribution).map((r) => ({ name: r.label, value: r.count }))}
        />
      }
      table={<HistogramTable rows={histogramRows(a.distribution)} />}
    />
  );
}

function AtRiskCard({ v, csv }: { v: CourseAnalytics; csv: ReactNode }) {
  const r = v.rules;
  const rules = [
    r.minGrade !== null ? `grade below ${r.minGrade}%` : null,
    r.missingCount !== null ? `${r.missingCount}+ missing in ${r.windowWeeks} weeks` : null,
    v.features.attendance && r.minAttendance !== null ? `attendance below ${r.minAttendance}%` : null,
    v.features.mastery && r.masteryBelowLevel !== null ? `average mastery below level ${r.masteryBelowLevel}` : null,
  ].filter(Boolean);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>
            <h3>Students at risk</h3>
          </CardTitle>
          <CardDescription>
            {rules.length ? `The school's rules: ${rules.join("; ")}.` : "The school has switched every rule off."}
          </CardDescription>
        </div>
        {csv}
      </CardHeader>
      <CardContent>
        {v.atRisk.length === 0 ? (
          <p className="text-sm text-muted-foreground">No students match the rules.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead className="text-right">Grade</TableHead>
                  <TableHead className="text-right">Missing</TableHead>
                  {v.features.attendance && <TableHead className="text-right">Attendance</TableHead>}
                  <TableHead>Reasons</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {v.atRisk.map((s) => (
                  <TableRow key={s.studentId}>
                    <TableCell className="font-medium">{studentName(s)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(s.grade)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.missingRecent}</TableCell>
                    {v.features.attendance && (
                      <TableCell className="text-right tabular-nums">{pct(s.attendanceRate)}</TableCell>
                    )}
                    <TableCell>
                      <RiskReasons reasons={s.reasons} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
