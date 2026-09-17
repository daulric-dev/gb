"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarCheck, ClipboardList, ScrollText } from "lucide-react";
import {
  formatDate,
  type PortalAttendance,
  type PortalMe,
  type PortalReportSummary,
} from "./_components/types";

export default function PortalOverviewPage() {
  useSignals();

  const me = useSignal<PortalMe | null>(null);
  const attendance = useSignal<PortalAttendance | null>(null);
  const reports = useSignal<PortalReportSummary[]>([]);
  const loading = useSignal(true);

  useEffect(() => {
    Promise.all([
      api<PortalMe>("/portal/me").catch(() => null),
      api<PortalAttendance>("/portal/me/attendance").catch(() => null),
      api<PortalReportSummary[]>("/portal/me/reports").catch(() => []),
    ])
      .then(([meData, attData, reportData]) => {
        me.value = meData;
        attendance.value = attData;
        reports.value = reportData ?? [];
      })
      .finally(() => (loading.value = false));
  }, [me, attendance, reports, loading]);

  if (loading.value) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const summary = attendance.value?.summary;
  const attendanceRate =
    summary && summary.total > 0
      ? Math.round(((summary.present + summary.late) / summary.total) * 100)
      : null;
  const latestReport = reports.value[0] ?? null;
  const activeClass =
    me.value?.classes.find((c) => c.academicYear?.isActive) ??
    me.value?.classes[0] ??
    null;

  return (
    <div className="space-y-6">
      <div className="animate-fade-in-up">
        <h1 className="text-3xl font-bold">
          Hello {me.value?.firstName ?? "there"}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {activeClass?.name
            ? `${activeClass.name}${
                activeClass.academicYear?.name
                  ? ` · ${activeClass.academicYear.name}`
                  : ""
              }`
            : "Your school record"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          href="/portal/attendance"
          icon={CalendarCheck}
          label="Attendance"
          value={attendanceRate === null ? "-" : `${attendanceRate}%`}
          hint={
            summary && summary.total > 0
              ? `${summary.present + summary.late} of ${summary.total} days`
              : "No records yet"
          }
        />
        <StatCard
          href="/portal/grades"
          icon={ClipboardList}
          label="Grades"
          value="View"
          hint="Your marks by subject"
        />
        <StatCard
          href="/portal/reports"
          icon={ScrollText}
          label="Reports"
          value={String(reports.value.length)}
          hint={reports.value.length === 1 ? "report" : "reports published"}
        />
      </div>

      {latestReport && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest report</CardTitle>
            <CardDescription>
              Published {formatDate(latestReport.publishedAt)}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            {latestReport.overallAverage !== null && (
              <Badge variant="secondary">
                Average {latestReport.overallAverage}
              </Badge>
            )}
            {latestReport.position !== null && (
              <Badge variant="secondary">
                Position {latestReport.position}
                {latestReport.totalStudents
                  ? ` of ${latestReport.totalStudents}`
                  : ""}
              </Badge>
            )}
            <Link
              href={`/portal/reports/${latestReport.id}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              Open report
            </Link>
          </CardContent>
        </Card>
      )}

      {me.value && me.value.classes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your classes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {me.value.classes.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <span className="text-sm font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">
                  {c.academicYear?.name}
                  {c.academicYear?.isActive && (
                    <Badge variant="secondary" className="ml-2">
                      Current
                    </Badge>
                  )}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  href,
  icon: Icon,
  label,
  value,
  hint,
}: {
  href: string;
  icon: typeof CalendarCheck;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Link href={href}>
      <Card className="h-full transition-colors hover:bg-muted/50">
        <CardContent className="flex items-start gap-3 py-4">
          <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold leading-tight">{value}</p>
            <p className="truncate text-xs text-muted-foreground">{hint}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
