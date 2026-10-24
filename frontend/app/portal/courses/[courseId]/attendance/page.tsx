"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { CalendarCheck, MapPin } from "lucide-react";
import { api } from "@/lib/api";
import type { PortalCourseAttendance } from "@/lib/courses/types";
import {
  formatCountdown,
  formatRate,
  formatSessionDate,
  formatTime,
  msUntil,
  rateColor,
  statusColor,
  statusLabel,
  useNow,
} from "@/lib/attendance";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "../../../_components/portal-ui";
import {
  CheckedInPill,
  CheckInButton,
} from "../../../_components/attendance-check-in";
import { openAttendance } from "../../../_components/attendance-store";
import { usePortalCourse } from "../_components/course-context";

export default function PortalCourseAttendancePage() {
  useSignals();
  const course = usePortalCourse();

  const data = useSignal<PortalCourseAttendance | null>(null);
  const loading = useSignal(true);

  const load = useCallback(async () => {
    try {
      data.value = await api<PortalCourseAttendance>(
        `/portal/me/courses/${course.id}/attendance`,
      );
    } catch {
      // Keep what we had; first load failing shows the empty state.
    } finally {
      loading.value = false;
    }
  }, [course.id, data, loading]);

  useEffect(() => {
    void load();
  }, [load]);

  const sessions = openAttendance.value.filter((s) => s.courseId === course.id);
  const now = useNow(1000, sessions.length > 0);
  const open = sessions.find((s) => msUntil(s.closesAt, now) > 0) ?? null;

  // Re-read the records when a session opens, is checked into, or closes.
  const openKey = open ? `${open.sessionId}:${open.myStatus ?? ""}` : "";
  const lastKey = useRef(openKey);
  useEffect(() => {
    if (lastKey.current === openKey) return;
    lastKey.current = openKey;
    void load();
  }, [openKey, load]);

  const checkInCard = open && (
    <Card className="animate-fade-in-up border-emerald-500/40 bg-emerald-500/5">
      <CardContent className="flex flex-wrap items-center gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
          <CalendarCheck className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">
            {open.title || "Attendance"} is open
          </p>
          <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
            <span>
              closes in{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatCountdown(msUntil(open.closesAt, now))}
              </span>
            </span>
            {open.requiresLocation && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" />
                location needed
              </span>
            )}
          </p>
        </div>
        {open.myStatus ? (
          <CheckedInPill status={open.myStatus} className="text-sm" />
        ) : (
          <CheckInButton
            session={open}
            size="lg"
            className="w-full sm:w-auto"
            onCheckedInAction={() => void load()}
          />
        )}
      </CardContent>
    </Card>
  );

  if (loading.value) {
    return (
      <div className="space-y-4">
        {checkInCard}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data.value) {
    return (
      <div className="space-y-4">
        {checkInCard}
        <EmptyState
          icon={CalendarCheck}
          title="Attendance unavailable"
          description="We couldn't load your attendance for this course. Try again shortly."
        />
      </div>
    );
  }

  const { summary, records } = data.value;
  const stats = [
    { label: "Present", value: summary.present, dot: "bg-emerald-500" },
    { label: "Late", value: summary.late, dot: "bg-amber-500" },
    { label: "Absent", value: summary.absent, dot: "bg-red-500" },
    { label: "Excused", value: summary.excused, dot: "bg-sky-500" },
  ];

  return (
    <div className="space-y-6">
      {checkInCard}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card className="col-span-2 sm:col-span-1">
          <CardHeader>
            <CardDescription>Attendance rate</CardDescription>
            <CardTitle
              className={cn("text-3xl font-bold", rateColor(summary.rate))}
            >
              {formatRate(summary.rate)}
            </CardTitle>
          </CardHeader>
        </Card>
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader>
              <CardDescription className="flex items-center gap-1.5">
                <span
                  className={cn("inline-block size-2 rounded-full", s.dot)}
                />
                {s.label}
              </CardDescription>
              <CardTitle className="text-3xl font-bold tabular-nums">
                {s.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {records.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="No attendance yet"
          description="When your teacher takes attendance, it shows up here."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {records.map((r) => (
                <li
                  key={r.sessionId}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {formatSessionDate(r.openedAt)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.title ? `${r.title} · ` : ""}
                      {r.checkedInAt
                        ? `Checked in ${formatTime(r.checkedInAt)}`
                        : r.status
                          ? "Not checked in"
                          : "Open now"}
                    </p>
                  </div>
                  <Badge className={statusColor(r.status)}>
                    {r.status ? statusLabel(r.status) : "Open"}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
