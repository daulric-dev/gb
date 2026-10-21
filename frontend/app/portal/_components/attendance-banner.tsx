"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSignals } from "@preact/signals-react/runtime";
import { CalendarCheck } from "lucide-react";
import { formatCountdown, msUntil, useNow } from "@/lib/attendance";
import type { PortalOpenAttendance } from "@/lib/courses/types";
import { CheckedInPill, CheckInButton } from "./attendance-check-in";
import { openAttendance, startAttendanceSync } from "./attendance-store";

/**
 * Open attendance sessions across the student's courses: a prominent banner
 * with a Check in button for each one not yet checked in, a small pill for
 * the ones already done. Mounted once in the portal layout.
 */
export function AttendanceBanner() {
  useSignals();
  const pathname = usePathname() ?? "";

  useEffect(() => startAttendanceSync(), []);

  const sessions = openAttendance.value;
  const now = useNow(1000, sessions.length > 0);
  const live = sessions.filter((s) => msUntil(s.closesAt, now) > 0);
  // The course attendance page shows its own check-in card.
  const visible = live.filter(
    (s) => pathname !== `/portal/courses/${s.courseId}/attendance`,
  );
  if (visible.length === 0) return null;

  const pending = visible.filter((s) => s.myStatus === null);
  const done = visible.filter((s) => s.myStatus !== null);

  return (
    <div className="mb-4 space-y-2">
      {pending.map((s) => (
        <PendingBanner key={s.sessionId} session={s} now={now} />
      ))}
      {done.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {done.map((s) => (
            <Link
              key={s.sessionId}
              href={`/portal/courses/${s.courseId}/attendance`}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckedInPill status={s.myStatus} />
              {s.courseName}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function PendingBanner({
  session,
  now,
}: {
  session: PortalOpenAttendance;
  now: number;
}) {
  const left = msUntil(session.closesAt, now);
  return (
    <div
      role="status"
      className="flex animate-fade-in-up flex-wrap items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 shadow-sm"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
        <CalendarCheck className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          Attendance is open in {session.courseName}
        </p>
        <p className="text-sm text-muted-foreground">
          {session.title ? `${session.title} · ` : ""}
          closes in{" "}
          <span className="font-medium tabular-nums text-foreground">
            {formatCountdown(left)}
          </span>
        </p>
      </div>
      <CheckInButton session={session} className="w-full sm:w-auto" />
    </div>
  );
}
