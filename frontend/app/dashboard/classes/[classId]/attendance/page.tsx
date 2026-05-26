"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Save, BarChart3 } from "lucide-react";
import { StudentAttendanceReport } from "./_components/StudentAttendanceReport";

type AttendanceStatus = "present" | "absent" | "late";

interface ClassInfo {
  id: string;
  name: string;
  isClassTeacher: boolean;
}

interface RosterEntry {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  record: {
    id: string;
    status: AttendanceStatus;
    notes: string | null;
  } | null;
}

interface RosterResponse {
  date: string;
  classId: string;
  entries: RosterEntry[];
}

const inputCls =
  "h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const STATUSES: AttendanceStatus[] = ["present", "absent", "late"];

export default function AttendancePage() {
  useSignals();
  const params = useParams();
  const router = useRouter();
  const classId = params?.classId as string;

  const classInfo = useSignal<ClassInfo | null>(null);
  const date = useSignal(todayIso());
  const loading = useSignal(true);
  const rosterLoading = useSignal(false);
  const saving = useSignal(false);
  const roster = useSignal<RosterEntry[]>([]);
  const marks = useSignal<Record<string, AttendanceStatus>>({});
  const reportStudent = useSignal<{ id: string; name: string } | null>(null);

  useEffect(() => {
    api<ClassInfo[]>("/classes")
      .then((cls) => {
        classInfo.value = cls.find((c) => c.id === classId) ?? null;
      })
      .catch(() => {
        classInfo.value = null;
      })
      .finally(() => (loading.value = false));
  }, [classId]);

  const fetchRoster = useCallback(() => {
    if (!date.value) return;
    rosterLoading.value = true;
    api<RosterResponse>(`/classes/${classId}/attendance?date=${date.value}`)
      .then((data) => {
        roster.value = data.entries;
        const next: Record<string, AttendanceStatus> = {};
        for (const e of data.entries) {
          if (e.record) next[e.studentId] = e.record.status;
        }
        marks.value = next;
      })
      .catch(() => {
        roster.value = [];
        marks.value = {};
        toast.error("Failed to load roster");
      })
      .finally(() => (rosterLoading.value = false));
  }, [classId, date.value]);

  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  const setStatus = (studentId: string, status: AttendanceStatus) => {
    marks.value = { ...marks.value, [studentId]: status };
  };

  const markAllPresent = () => {
    const next: Record<string, AttendanceStatus> = {};
    for (const e of roster.value) next[e.studentId] = "present";
    marks.value = next;
  };

  const save = async () => {
    const entries = Object.entries(marks.value).map(([studentId, status]) => ({
      studentId,
      status,
    }));
    if (entries.length === 0) {
      toast.error("Mark at least one student before saving");
      return;
    }
    saving.value = true;
    try {
      await api(`/classes/${classId}/attendance/bulk`, {
        method: "POST",
        body: { date: date.value, entries },
      });
      toast.success(`Attendance saved for ${entries.length} student${entries.length === 1 ? "" : "s"}`);
      fetchRoster();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Failed to save attendance";
      toast.error(msg);
    } finally {
      saving.value = false;
    }
  };

  if (loading.value) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!classInfo.value) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Class not found or you don&apos;t have access.
      </div>
    );
  }

  const canMark = classInfo.value.isClassTeacher;
  const totalMarked = Object.keys(marks.value).length;
  const totalStudents = roster.value.length;

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={`${classInfo.value.name} - Attendance`}
        description={
          canMark
            ? "Mark each student present, absent, or late for the selected date"
            : "View attendance records for this class"
        }
        onBack={() => router.push(`/dashboard/classes/${classId}`)}
        actions={
          canMark && (
            <Button onClick={save} disabled={saving.value || totalStudents === 0}>
              <Save className="mr-2 size-4" />
              {saving.value ? "Saving…" : "Save"}
            </Button>
          )
        }
      />

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <CardTitle>Roster</CardTitle>
              <CardDescription>
                {totalStudents > 0
                  ? `${totalMarked} of ${totalStudents} marked`
                  : "No students enrolled in this class"}
              </CardDescription>
            </div>
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Date</label>
                <input
                  type="date"
                  className={inputCls}
                  value={date.value}
                  max={todayIso()}
                  onChange={(e) => (date.value = e.target.value)}
                />
              </div>
              {canMark && totalStudents > 0 && (
                <Button variant="outline" size="sm" onClick={markAllPresent}>
                  Mark all present
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {rosterLoading.value ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : totalStudents === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No students enrolled in this class.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Report</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roster.value.map((e) => {
                    const current = marks.value[e.studentId];
                    return (
                      <TableRow key={e.studentId}>
                        <TableCell className="font-medium">
                          {e.firstName} {e.lastName}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="inline-flex rounded-md border">
                            {STATUSES.map((s) => (
                              <button
                                key={s}
                                type="button"
                                disabled={!canMark}
                                onClick={() => setStatus(e.studentId, s)}
                                className={`px-3 py-1 text-xs capitalize first:rounded-l-md last:rounded-r-md not-first:border-l ${
                                  current === s
                                    ? statusActiveCls(s)
                                    : "bg-transparent text-muted-foreground hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent"
                                }`}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              (reportStudent.value = {
                                id: e.studentId,
                                name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
                              })
                            }
                          >
                            <BarChart3 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={reportStudent.value !== null}
        onOpenChange={(open) => {
          if (!open) reportStudent.value = null;
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Attendance - {reportStudent.value?.name || "Student"}
            </DialogTitle>
            <DialogDescription>
              Summary and recorded marks over a date range
            </DialogDescription>
          </DialogHeader>
          {reportStudent.value && (
            <StudentAttendanceReport
              classId={classId}
              studentId={reportStudent.value.id}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function statusActiveCls(status: AttendanceStatus): string {
  switch (status) {
    case "present":
      return "bg-emerald-600 text-white";
    case "late":
      return "bg-amber-500 text-white";
    case "absent":
      return "bg-rose-600 text-white";
  }
}
