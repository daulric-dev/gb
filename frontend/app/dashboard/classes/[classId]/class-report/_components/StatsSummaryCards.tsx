"use client";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ClassSummary, ReportType } from "@/lib/reports";

interface StatsSummaryCardsProps {
  summary: ClassSummary;
  reportType: ReportType;
}

export function StatsSummaryCards({ summary: s, reportType }: StatsSummaryCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Class Average</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {s.classAverage != null ? s.classAverage.toFixed(2) : "-"}
          </CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Highest / Lowest</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {s.highestAverage != null ? s.highestAverage.toFixed(1) : "-"}
            {" / "}
            {s.lowestAverage != null ? s.lowestAverage.toFixed(1) : "-"}
          </CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>
            Students ({s.totalStudents})
          </CardDescription>
          <CardTitle className="text-2xl">
            <span className="text-green-600 dark:text-green-400">
              {s.passCount} pass
            </span>
            {" / "}
            <span className="text-red-600 dark:text-red-400">
              {s.failCount} fail
            </span>
          </CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>
            {reportType === "year_end"
              ? "Year Weights"
              : "Term Weights"}
          </CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            CW {s.courseworkWeight}% / EX {s.examWeight}%
          </CardTitle>
        </CardHeader>
      </Card>
    </div>
  );
}
