"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSignals } from "@preact/signals-react/runtime";
import {
  CalendarX,
  CircleCheckBig,
  CircleX,
  Loader2,
  MapPin,
  MapPinOff,
  ShieldAlert,
  TimerOff,
  type LucideIcon,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  ATTENDANCE_STATUS_LABEL,
  checkInErrorMessage,
  getCurrentPosition,
  statusColor,
} from "@/lib/attendance";
import type { PortalOpenAttendance } from "@/lib/courses/types";
import { isStudentProfile } from "@/lib/routing";
import { cn } from "@/lib/utils";
import { useProfile } from "@/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { upsertOpenAttendance } from "../../_components/attendance-store";
import { clearScanClaim, readScanClaim } from "@/lib/attendance-scan";

type ErrorReason = "expired" | "closed" | "far" | "other";

type ScanState =
  | { kind: "checking"; locating?: boolean }
  | {
      kind: "location";
      session: PortalOpenAttendance;
      error?: string;
      busy?: boolean;
    }
  | { kind: "success"; session: PortalOpenAttendance; already: boolean }
  | { kind: "error"; reason: ErrorReason; message: string };

async function fetchOpen(
  sessionId: string,
): Promise<PortalOpenAttendance | null> {
  const open = await api<PortalOpenAttendance[]>("/portal/me/attendance/open");
  return open.find((o) => o.sessionId === sessionId) ?? null;
}

function errorReason(err: ApiError): ErrorReason {
  if (err.status === 409 && /expired|qr/i.test(err.message)) return "expired";
  if (err.status === 409 && /closed/i.test(err.message)) return "closed";
  if (err.status === 404) return "closed";
  if (err.status === 403 && /far/i.test(err.message)) return "far";
  return "other";
}

/**
 * Landing page for the attendance QR on the teacher's screen. The phone
 * camera opens `?s=<session>&t=<token>`; this checks the student in straight
 * away (asking for location first when the session needs it).
 */
function ScanCheckIn() {
  useSignals();
  const params = useSearchParams();
  const sessionId = params?.get("s") ?? "";
  const token = params?.get("t") ?? "";
  // Set by the public /scan page when the QR was scanned before signing in;
  // a live token in the URL still wins when there is one.
  const [claim] = useState(() => (sessionId ? readScanClaim(sessionId) : null));
  const proof = token
    ? { qrToken: token }
    : claim
      ? { qrClaim: claim }
      : null;
  const { profile } = useProfile();
  const isStudent = isStudentProfile(profile.value);

  const [state, setState] = useState<ScanState>({ kind: "checking" });
  // One automatic attempt per scanned link (Strict Mode runs effects twice).
  const startedFor = useRef<string | null>(null);

  async function checkIn(session: PortalOpenAttendance, withLocation: boolean) {
    try {
      let location: {
        latitude: number;
        longitude: number;
        accuracy: number;
      } | null = null;
      if (withLocation) {
        setState({ kind: "location", session, busy: true });
        const pos = await getCurrentPosition();
        location = {
          latitude: pos.latitude,
          longitude: pos.longitude,
          accuracy: pos.accuracy,
        };
      }
      setState({ kind: "checking" });
      const result = await api<PortalOpenAttendance>(
        `/portal/me/attendance/${session.sessionId}/check-in`,
        {
          method: "POST",
          body: { ...proof, ...(location ? { location } : {}) },
        },
      );
      clearScanClaim(session.sessionId);
      upsertOpenAttendance(result);
      setState({ kind: "success", session: result, already: false });
    } catch (err) {
      if (!(err instanceof ApiError)) {
        // Geolocation refused or failed: explain and let them try again.
        setState({
          kind: "location",
          session,
          error: checkInErrorMessage(err),
        });
        return;
      }
      if (err.status === 409 && /already/i.test(err.message)) {
        const fresh = await fetchOpen(session.sessionId).catch(() => null);
        setState({
          kind: "success",
          session: fresh ?? session,
          already: true,
        });
        return;
      }
      if (err.status === 400 && /location/i.test(err.message)) {
        setState({ kind: "location", session, error: err.message });
        return;
      }
      setState({
        kind: "error",
        reason: errorReason(err),
        message: checkInErrorMessage(err),
      });
    }
  }

  async function begin() {
    try {
      const session = await fetchOpen(sessionId);
      if (!session) {
        setState({
          kind: "error",
          reason: "closed",
          message: "This attendance session is no longer open.",
        });
        return;
      }
      if (session.myStatus) {
        setState({ kind: "success", session, already: true });
        return;
      }
      if (session.requiresLocation) {
        setState({ kind: "location", session });
        return;
      }
      await checkIn(session, false);
    } catch (err) {
      setState({
        kind: "error",
        reason: "other",
        message: checkInErrorMessage(err),
      });
    }
  }

  const ready = isStudent && !!sessionId && !!proof;
  useEffect(() => {
    if (!ready) return;
    const key = `${sessionId}:${token || claim}`;
    if (startedFor.current === key) return;
    startedFor.current = key;
    void begin();
    // begin() reads the same sessionId/token captured in `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sessionId, token]);

  if (!isStudent) {
    return (
      <Outcome
        icon={ShieldAlert}
        tone="muted"
        title="Only students check in"
        body="You're signed in with a staff account. Students scan this code to mark themselves present."
        action={{ href: "/dashboard", label: "Go to the dashboard" }}
      />
    );
  }

  if (!sessionId || !proof) {
    return (
      <Outcome
        icon={CircleX}
        tone="error"
        title="This link is incomplete"
        body="Scan the code on screen again."
        action={{ href: "/portal", label: "Back to your portal" }}
      />
    );
  }

  switch (state.kind) {
    case "checking":
      return (
        <Shell>
          <Loader2 className="size-12 animate-spin text-muted-foreground" />
          <p className="text-lg font-medium">Checking you in…</p>
        </Shell>
      );

    case "location":
      return (
        <Shell>
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
            <MapPin className="size-7 text-primary" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold">
              {state.session.courseName}
            </h1>
            <p className="text-sm text-muted-foreground">
              Your teacher asked to confirm you are in the room. Your browser
              will ask to share your location once, only for this check-in.
            </p>
          </div>
          {state.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}
          <Button
            size="lg"
            className="w-full"
            disabled={state.busy}
            onClick={() => void checkIn(state.session, true)}
          >
            {state.busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            {state.busy ? "Checking location…" : "Share location and check in"}
          </Button>
          <Link
            href="/portal"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Not now
          </Link>
        </Shell>
      );

    case "success": {
      const { session, already } = state;
      return (
        <Shell>
          <CircleCheckBig className="size-20 text-emerald-600 dark:text-emerald-400" />
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold">
              {already ? "Already checked in" : "You're checked in"}
            </h1>
            <p className="text-lg">{session.courseName}</p>
            {session.title && (
              <p className="text-sm text-muted-foreground">{session.title}</p>
            )}
          </div>
          {session.myStatus && (
            <Badge
              className={cn("px-3 py-1 text-sm", statusColor(session.myStatus))}
            >
              {ATTENDANCE_STATUS_LABEL[session.myStatus]}
            </Badge>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link href={`/portal/courses/${session.courseId}/attendance`} />
              }
            >
              My attendance
            </Button>
            <Button nativeButton={false} render={<Link href="/portal" />}>
              Done
            </Button>
          </div>
        </Shell>
      );
    }

    case "error": {
      const view: Record<
        ErrorReason,
        { icon: LucideIcon; title: string; body: string }
      > = {
        expired: {
          icon: TimerOff,
          title: "That QR code has expired",
          body: "Scan the code on screen again.",
        },
        closed: {
          icon: CalendarX,
          title: "Attendance has closed",
          body: "Ask your teacher if you need to be marked present.",
        },
        far: {
          icon: MapPinOff,
          title: "You're too far from the classroom",
          body: "Move closer to the room and scan the code on screen again.",
        },
        other: {
          icon: CircleX,
          title: "Could not check you in",
          body: state.message,
        },
      };
      const v = view[state.reason];
      return (
        <Outcome
          icon={v.icon}
          tone="error"
          title={v.title}
          body={v.body}
          action={{ href: "/portal", label: "Back to your portal" }}
        />
      );
    }
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-sm flex-col items-center justify-center gap-5 py-8 text-center">
      {children}
    </div>
  );
}

function Outcome({
  icon: Icon,
  tone,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  tone: "error" | "muted";
  title: string;
  body: string;
  action: { href: string; label: string };
}) {
  return (
    <Shell>
      <div
        className={cn(
          "flex size-16 items-center justify-center rounded-full",
          tone === "error"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-8" />
      </div>
      <div
        className="space-y-1.5"
        role={tone === "error" ? "alert" : undefined}
      >
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      <Button nativeButton={false} render={<Link href={action.href} />}>
        {action.label}
      </Button>
    </Shell>
  );
}

export default function AttendanceScanPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <Loader2 className="size-12 animate-spin text-muted-foreground" />
        </Shell>
      }
    >
      <ScanCheckIn />
    </Suspense>
  );
}
