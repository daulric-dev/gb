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
import { ChevronRight } from "lucide-react";
import {
  formatDate,
  termLabel,
  type PortalReportSummary,
} from "../_components/types";

export default function PortalReportsPage() {
  useSignals();

  const reports = useSignal<PortalReportSummary[]>([]);
  const loading = useSignal(true);

  useEffect(() => {
    api<PortalReportSummary[]>("/portal/me/reports")
      .then((data) => (reports.value = data))
      .catch(() => (reports.value = []))
      .finally(() => (loading.value = false));
  }, [reports, loading]);

  if (loading.value) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Reports</h1>
        <p className="mt-1 text-muted-foreground">
          Report books your school has published
        </p>
      </div>

      {reports.value.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No reports have been published yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.value.map((report) => (
            <Link key={report.id} href={`/portal/reports/${report.id}`}>
              <Card className="transition-colors hover:bg-muted/50">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base">
                        {report.type === "year_end"
                          ? "End of year report"
                          : `${termLabel(report.term?.name)} report`}
                      </CardTitle>
                      <CardDescription>
                        {report.academicYear?.name}
                        {report.publishedAt &&
                          ` · published ${formatDate(report.publishedAt)}`}
                      </CardDescription>
                    </div>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2 pt-0">
                  {report.overallAverage !== null && (
                    <Badge variant="secondary">
                      Average {report.overallAverage}
                    </Badge>
                  )}
                  {report.position !== null && (
                    <Badge variant="secondary">
                      Position {report.position}
                      {report.totalStudents ? ` of ${report.totalStudents}` : ""}
                    </Badge>
                  )}
                  {report.conductGrade && (
                    <Badge variant="outline">
                      Conduct {report.conductGrade}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
