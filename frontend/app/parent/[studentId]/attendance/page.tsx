"use client";

import { useParams } from "next/navigation";
import { useSignals } from "@preact/signals-react/runtime";
import { attendanceRate, type ParentAttendance } from "@/lib/parent";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useChildData } from "../../_components/use-child-data";
import { formatWhen, Loading, Notice } from "../../_components/ui";

const LABEL = { present: "Present", late: "Late", absent: "Absent", excused: "Excused" } as const;

/** Attendance per course: status and time only. */
export default function ParentAttendancePage() {
  useSignals();
  const { studentId } = useParams<{ studentId: string }>();
  const res = useChildData<ParentAttendance>(`/parent/children/${studentId}/attendance`);

  if (res.loading.value) return <Loading />;
  if (res.error.value || !res.data.value) return <Notice>{res.error.value ?? "No attendance yet."}</Notice>;
  const a = res.data.value;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Attendance</h1>
        <p className="text-sm text-muted-foreground" translate="no">
          {attendanceRate(a.summary)} attended · {a.summary.absent} absent · {a.summary.late} late
        </p>
      </div>
      {a.courses.length === 0 && <Notice>No attendance yet.</Notice>}
      {a.courses.map((c) => (
        <Card key={c.courseId}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="truncate">{c.courseName}</span>
              <span className="text-sm font-normal text-muted-foreground" translate="no">{attendanceRate(c.summary)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {c.records.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sessions yet.</p>
            ) : (
              <ul className="divide-y">
                {c.records.map((r) => (
                  <li key={r.sessionId} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{r.title || "Session"}</p>
                      <p className="text-xs text-muted-foreground">{formatWhen(r.openedAt, true)}</p>
                    </div>
                    <Badge variant={r.status === "absent" ? "destructive" : "outline"}>
                      {r.status ? LABEL[r.status] : "Not recorded"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
