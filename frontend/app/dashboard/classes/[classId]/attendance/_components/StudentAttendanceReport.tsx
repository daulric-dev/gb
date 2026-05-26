"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type AttendanceStatus = "present" | "absent" | "late";

interface SummaryResponse {
  counts: {
    present: number;
    absent: number;
    late: number;
    total: number;
  };
  presentPercentage: number;
}

interface RangeResponse {
  records: {
    id: string;
    date: string;
    status: AttendanceStatus;
    notes: string | null;
  }[];
}

const inputCls =
  "h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function StudentAttendanceReport({
  classId,
  studentId,
}: {
  classId: string;
  studentId: string;
}) {
  useSignals();

  const from = useSignal(isoDaysAgo(30));
  const to = useSignal(todayIso());
  const summary = useSignal<SummaryResponse | null>(null);
  const records = useSignal<RangeResponse["records"]>([]);
  const loading = useSignal(false);

  useEffect(() => {
    if (!from.value || !to.value || from.value > to.value) return;
    loading.value = true;
    Promise.all([
      api<SummaryResponse>(
        `/classes/${classId}/attendance/students/${studentId}/summary?from=${from.value}&to=${to.value}`,
      ),
      api<RangeResponse>(
        `/classes/${classId}/attendance/students/${studentId}?from=${from.value}&to=${to.value}`,
      ),
    ])
      .then(([s, r]) => {
        summary.value = s;
        records.value = r.records;
      })
      .catch(() => {
        summary.value = null;
        records.value = [];
      })
      .finally(() => (loading.value = false));
  }, [from.value, to.value, classId, studentId]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">From</label>
          <input
            type="date"
            className={`${inputCls} w-full`}
            value={from.value}
            max={to.value}
            onChange={(e) => (from.value = e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">To</label>
          <input
            type="date"
            className={`${inputCls} w-full`}
            value={to.value}
            min={from.value}
            onChange={(e) => (to.value = e.target.value)}
          />
        </div>
      </div>

      {loading.value ? (
        <Skeleton className="h-24 w-full" />
      ) : summary.value && summary.value.counts.total > 0 ? (
        <div className="grid grid-cols-4 gap-2 rounded-md border p-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Present</div>
            <div className="font-semibold tabular-nums">
              {summary.value.counts.present}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Late</div>
            <div className="font-semibold tabular-nums">
              {summary.value.counts.late}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Absent</div>
            <div className="font-semibold tabular-nums">
              {summary.value.counts.absent}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Attended</div>
            <div className="font-semibold tabular-nums">
              {summary.value.presentPercentage.toFixed(1)}%
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          No attendance recorded in this range.
        </div>
      )}

      {!loading.value && records.value.length > 0 && (
        <div className="rounded-md border max-h-64 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.value.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">{r.date}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.notes ?? ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AttendanceStatus }) {
  const cls =
    status === "present"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100"
      : status === "late"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100"
        : "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100";
  return (
    <Badge variant="outline" className={`capitalize ${cls}`}>
      {status}
    </Badge>
  );
}
