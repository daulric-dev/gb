"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import { formatDate, type PortalAttendance } from "../_components/types";

const STATUS_STYLES: Record<string, string> = {
  present: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  late: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  absent: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export default function PortalAttendancePage() {
  useSignals();

  const data = useSignal<PortalAttendance | null>(null);
  const loading = useSignal(true);

  useEffect(() => {
    api<PortalAttendance>("/portal/me/attendance")
      .then((res) => (data.value = res))
      .catch(() => (data.value = null))
      .finally(() => (loading.value = false));
  }, [data, loading]);

  if (loading.value) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const summary = data.value?.summary;
  const records = data.value?.records ?? [];
  const rate =
    summary && summary.total > 0
      ? Math.round(((summary.present + summary.late) / summary.total) * 100)
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Attendance</h1>
        <p className="mt-1 text-muted-foreground">
          {rate === null
            ? "Your attendance record"
            : `${rate}% attendance across ${summary!.total} recorded days`}
        </p>
      </div>

      {summary && summary.total > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Tally label="Present" value={summary.present} tone="present" />
          <Tally label="Late" value={summary.late} tone="late" />
          <Tally label="Absent" value={summary.absent} tone="absent" />
        </div>
      )}

      {records.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No attendance has been recorded yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{formatDate(r.date)}</TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="secondary"
                        className={cn("capitalize", STATUS_STYLES[r.status])}
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: keyof typeof STATUS_STYLES;
}) {
  return (
    <Card>
      <CardContent className="py-4 text-center">
        <p
          className={cn(
            "text-2xl font-semibold",
            tone === "present" && "text-emerald-600 dark:text-emerald-400",
            tone === "late" && "text-amber-600 dark:text-amber-400",
            tone === "absent" && "text-red-600 dark:text-red-400",
          )}
        >
          {value}
        </p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
