"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import {
  formatDate,
  termLabel,
  type PortalReport,
} from "../../_components/types";

function num(value: number | null) {
  return value === null ? "-" : String(value);
}

export default function PortalReportPage() {
  useSignals();

  const router = useRouter();
  const params = useParams<{ reportId: string }>();
  const reportId = params?.reportId;

  const report = useSignal<PortalReport | null>(null);
  const loading = useSignal(true);

  useEffect(() => {
    if (!reportId) return;
    api<PortalReport>(`/portal/me/reports/${reportId}`)
      .then((data) => (report.value = data))
      .catch(() => (report.value = null))
      .finally(() => (loading.value = false));
  }, [reportId, report, loading]);

  if (loading.value) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!report.value) {
    return (
      <div className="space-y-6">
        <BackTitleToolbar
          title="Report"
          description="This report could not be loaded"
          onBack={() => router.push("/portal/reports")}
        />
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            This report is not available.
          </CardContent>
        </Card>
      </div>
    );
  }

  const r = report.value;
  const title =
    r.type === "year_end"
      ? "End of year report"
      : `${termLabel(r.term?.name)} report`;

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={title}
        description={[r.academicYear?.name, formatDate(r.publishedAt)]
          .filter(Boolean)
          .join(" · ")}
        onBack={() => router.push("/portal/reports")}
      />

      <div className="flex flex-wrap gap-2">
        {r.overallAverage !== null && (
          <Badge variant="secondary">Average {r.overallAverage}</Badge>
        )}
        {r.position !== null && (
          <Badge variant="secondary">
            Position {r.position}
            {r.totalStudents ? ` of ${r.totalStudents}` : ""}
          </Badge>
        )}
        {r.conductGrade && (
          <Badge variant="outline">Conduct {r.conductGrade}</Badge>
        )}
        {r.attendanceDays !== null && r.totalSchoolDays !== null && (
          <Badge variant="outline">
            Attendance {r.attendanceDays}/{r.totalSchoolDays}
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Subjects</CardTitle>
        </CardHeader>
        <CardContent>
          {r.entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No subject entries on this report.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead className="text-right">Coursework</TableHead>
                  <TableHead className="text-right">Exam</TableHead>
                  <TableHead className="text-right">Term</TableHead>
                  <TableHead className="text-right">Grade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <span className="font-medium">
                        {e.subject?.name ?? "-"}
                      </span>
                      {e.teacherRemark && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {e.teacherRemark}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {num(e.courseworkAverage)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {num(e.examAverage)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {num(e.termAverage ?? e.termComposite)}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.letterGrade ? (
                        <Badge variant="outline">{e.letterGrade}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {r.generalRemarks && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Remarks</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {r.generalRemarks}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
