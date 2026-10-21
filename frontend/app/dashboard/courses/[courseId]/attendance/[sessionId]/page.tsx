"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  ArrowLeft,
  Loader2,
  MapPin,
  Maximize2,
  Search,
  SearchX,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type {
  AttendanceRosterEntry,
  AttendanceSession,
  AttendanceSessionDetail,
  AttendanceStatus,
} from "@/lib/courses/types";
import { personName } from "@/lib/courses/format";
import {
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_STATUSES,
  formatCountdown,
  formatSessionDate,
  formatTime,
  openStream,
  useCountdown,
} from "@/lib/attendance";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useCourse } from "../../_components/course-context";
import {
  AttendanceStatusBadge,
  CountBadges,
  MethodIcon,
} from "../_components/attendance-ui";
import {
  AttendanceQr,
  QR_CAPTION,
  useQrFrame,
} from "../_components/attendance-qr";

const POLL_MS = 10_000;
const STATUS_ITEMS = ATTENDANCE_STATUSES.map((s) => ({
  value: s,
  label: ATTENDANCE_STATUS_LABEL[s],
}));

function countRoster(
  roster: AttendanceRosterEntry[],
): AttendanceSession["counts"] {
  const counts = { present: 0, late: 0, absent: 0, excused: 0, pending: 0 };
  for (const r of roster) {
    if (r.status) counts[r.status] += 1;
    else counts.pending += 1;
  }
  return counts;
}

function sortRoster(roster: AttendanceRosterEntry[]) {
  return [...roster].sort((a, b) =>
    `${a.lastName ?? ""} ${a.firstName ?? ""}`.localeCompare(
      `${b.lastName ?? ""} ${b.firstName ?? ""}`,
    ),
  );
}

export default function AttendanceSessionPage() {
  useSignals();
  const { course, base, canManage } = useCourse();
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params?.sessionId ?? "";

  const detail = useSignal<AttendanceSessionDetail | null>(null);
  const loading = useSignal(true);
  const missing = useSignal(false);
  const closing = useSignal(false);
  const presenting = useSignal(false);
  const confirmDelete = useSignal(false);
  const deleting = useSignal(false);
  const search = useSignal("");
  const saving = useSignal<Record<string, boolean>>({});

  const sessionPath = `/courses/${course.id}/attendance/sessions/${sessionId}`;

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      detail.value = await api<AttendanceSessionDetail>(sessionPath);
      missing.value = false;
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.status === 404 || err.status === 403)
      ) {
        missing.value = true;
        detail.value = null;
      }
    } finally {
      loading.value = false;
    }
  }, [sessionId, sessionPath, detail, missing, loading]);

  useEffect(() => {
    void load();
  }, [load]);

  const remaining = useCountdown(
    detail.value?.isOpen ? detail.value.closesAt : null,
  );
  const isOpen = !!detail.value?.isOpen;
  const live = isOpen && remaining > 0;

  // Rotating QR while open; a "closed" answer re-reads the session.
  const qr = useQrFrame(sessionPath, isOpen && !!sessionId, load);
  const showQr = isOpen && !qr.unavailable;

  // Live roster over SSE while open, polling every 10 s if the stream drops.
  useEffect(() => {
    if (!isOpen || !sessionId) return;
    let poll: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (!poll) poll = setInterval(() => void load(), POLL_MS);
    };
    const stopPolling = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };
    const close = openStream(`${sessionPath}/stream`, {
      events: {
        "attendance.record": (data) => {
          const entry = data as AttendanceRosterEntry;
          const cur = detail.value;
          if (!cur || !entry?.studentId) return;
          const exists = cur.roster.some(
            (r) => r.studentId === entry.studentId,
          );
          const roster = exists
            ? cur.roster.map((r) =>
                r.studentId === entry.studentId ? entry : r,
              )
            : [...cur.roster, entry];
          detail.value = { ...cur, roster, counts: countRoster(roster) };
        },
        "attendance.closed": () => void load(),
      },
      onOpen: stopPolling,
      onError: startPolling,
    });
    return () => {
      close();
      stopPolling();
    };
  }, [isOpen, sessionId, sessionPath, load, detail]);

  // When the countdown runs out, re-read: the API finalises expired sessions
  // on read. Once per closesAt so a slow sweep cannot loop us.
  const refreshedFor = useRef<string | null>(null);
  const closesAt = detail.value?.closesAt ?? null;
  useEffect(() => {
    if (!isOpen || remaining > 0 || !closesAt) return;
    if (refreshedFor.current === closesAt) return;
    refreshedFor.current = closesAt;
    const t = setTimeout(() => void load(), 1500);
    return () => clearTimeout(t);
  }, [isOpen, remaining, closesAt, load]);

  // Leave the presenter view if the browser leaves fullscreen (Esc).
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) presenting.value = false;
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [presenting]);

  async function present() {
    presenting.value = true;
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // The overlay still covers the page without real fullscreen.
    }
  }

  async function stopPresenting() {
    presenting.value = false;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
  }

  async function closeNow() {
    closing.value = true;
    try {
      detail.value = await api<AttendanceSessionDetail>(
        `${sessionPath}/close`,
        {
          method: "POST",
        },
      );
      toast.success("Attendance closed");
      void stopPresenting();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not close");
    } finally {
      closing.value = false;
    }
  }

  async function setStatus(studentId: string, status: AttendanceStatus) {
    saving.value = { ...saving.value, [studentId]: true };
    try {
      const entry = await api<AttendanceRosterEntry>(
        `${sessionPath}/records/${studentId}`,
        { method: "PATCH", body: { status } },
      );
      const cur = detail.value;
      if (cur) {
        const roster = cur.roster.map((r) =>
          r.studentId === studentId ? { ...r, ...entry } : r,
        );
        detail.value = { ...cur, roster, counts: countRoster(roster) };
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update");
    } finally {
      const next = { ...saving.value };
      delete next[studentId];
      saving.value = next;
    }
  }

  async function remove() {
    deleting.value = true;
    try {
      await api(sessionPath, { method: "DELETE" });
      toast.success("Session deleted");
      router.push(`${base}/attendance`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete");
      deleting.value = false;
    }
  }

  const back = (
    <Link
      href={`${base}/attendance`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Attendance
    </Link>
  );

  if (loading.value) {
    return (
      <div className="space-y-5">
        {back}
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const s = detail.value;
  if (!s) {
    return (
      <div className="space-y-5">
        {back}
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>
              {missing.value
                ? "Session not found"
                : "Could not load the session"}
            </EmptyTitle>
            <EmptyDescription>
              {missing.value
                ? "It may have been deleted."
                : "Check your connection and try again."}
            </EmptyDescription>
          </EmptyHeader>
          {!missing.value && (
            <EmptyContent>
              <Button variant="outline" onClick={() => void load()}>
                Try again
              </Button>
            </EmptyContent>
          )}
        </Empty>
      </div>
    );
  }

  const counts = countRoster(s.roster);
  const total = s.roster.length;
  const checkedIn = total - counts.pending;
  const q = search.value.trim().toLowerCase();
  const rows = sortRoster(s.roster).filter(
    (r) => !q || personName(r).toLowerCase().includes(q),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => (confirmDelete.value = true)}
          >
            <Trash2 className="mr-1.5 size-4" />
            Delete session
          </Button>
        )}
      </div>

      <div className="animate-fade-in-up">
        <h2 className="text-xl font-semibold">{s.title || "Attendance"}</h2>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{formatSessionDate(s.openedAt)}</span>
          {s.lateAfterMinutes !== null && (
            <span>Late after {s.lateAfterMinutes} min</span>
          )}
          {s.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" />
              Within {s.location.radiusM} m
            </span>
          )}
        </p>
      </div>

      {isOpen ? (
        <div className="animate-fade-in-up-delay-1 flex flex-col items-center gap-6 rounded-xl border bg-card p-6 text-center shadow-sm md:flex-row md:justify-center md:gap-10">
          {showQr && (
            <div className="w-full max-w-70 shrink-0">
              <AttendanceQr state={qr} />
              <p className="mt-1 text-xs text-muted-foreground">{QR_CAPTION}</p>
            </div>
          )}
          <div className="min-w-0">
            {s.requiresCode && s.checkInCode ? (
              <>
                <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                  Check-in code
                </p>
                <p
                  className="mt-2 font-mono text-7xl font-bold tracking-[0.3em] tabular-nums lg:text-8xl"
                  aria-label={`Code ${s.checkInCode.split("").join(" ")}`}
                >
                  {s.checkInCode}
                </p>
              </>
            ) : (
              <p className="text-lg font-medium">
                {showQr
                  ? "No code needed. Students scan the QR or press Check in."
                  : "No code needed. Students just press Check in."}
              </p>
            )}
            <p
              className={cn(
                "mt-4 font-mono text-3xl font-semibold tabular-nums",
                remaining < 30_000 && "text-red-600 dark:text-red-400",
              )}
            >
              {live ? formatCountdown(remaining) : "Closing…"}
            </p>
            <div className="mx-auto mt-5 max-w-sm space-y-1.5">
              <Progress value={total ? (checkedIn / total) * 100 : 0} />
              <p className="text-sm tabular-nums text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {checkedIn}
                </span>{" "}
                / {total} checked in
              </p>
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={() => void present()}>
                <Maximize2 className="mr-2 size-4" />
                Present
              </Button>
              <Button
                variant="destructive"
                onClick={() => void closeNow()}
                disabled={closing.value}
              >
                {closing.value ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Square className="mr-2 size-4" />
                )}
                Close now
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <Badge variant="outline">Closed</Badge>
          <span className="text-muted-foreground">
            {s.closedAt ? `Closed ${formatTime(s.closedAt)}` : "Closed"} ·
            change any status below
          </span>
          <div className="ml-auto">
            <CountBadges counts={counts} showPending={false} />
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="relative w-fit">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Find a student"
            className="w-56 pl-8"
            value={search.value}
            onChange={(e) => (search.value = e.target.value)}
          />
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Checked in</TableHead>
                <TableHead className="text-right">Distance</TableHead>
                <TableHead className="text-center">How</TableHead>
                <TableHead className="w-40">Set status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {total === 0 ? "No active students." : "No match."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.studentId}>
                    <TableCell>
                      <span className="font-medium">{personName(r)}</span>
                      {!r.hasAccount && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          (no account)
                        </span>
                      )}
                      {r.note && (
                        <p className="max-w-56 truncate text-xs text-muted-foreground">
                          {r.note}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <AttendanceStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {r.checkedInAt ? formatTime(r.checkedInAt) : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.distanceM !== null
                        ? `${Math.round(r.distanceM)} m`
                        : "-"}
                    </TableCell>
                    <TableCell className="text-center">
                      <MethodIcon method={r.method} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Select
                          value={r.status}
                          onValueChange={(v) => {
                            if (v && v !== r.status) {
                              void setStatus(
                                r.studentId,
                                v as AttendanceStatus,
                              );
                            }
                          }}
                          items={STATUS_ITEMS}
                          disabled={!!saving.value[r.studentId]}
                        >
                          <SelectTrigger size="sm" className="w-32">
                            <SelectValue placeholder="Set…" />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_ITEMS.map((it) => (
                              <SelectItem key={it.value} value={it.value}>
                                {it.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {saving.value[r.studentId] && (
                          <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {presenting.value && isOpen && (
        <div className="fixed inset-0 z-100 flex flex-col items-center justify-center gap-8 overflow-auto bg-background p-8 text-center landscape:flex-row landscape:gap-16">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4"
            aria-label="Exit presenter view"
            onClick={() => void stopPresenting()}
          >
            <X className="size-5" />
          </Button>
          {showQr && (
            <div className="w-[min(58vh,86vw)] shrink-0 landscape:w-[min(78vh,46vw)]">
              <AttendanceQr state={qr} />
              <p className="mt-2 text-base text-muted-foreground sm:text-lg">
                {QR_CAPTION}
              </p>
            </div>
          )}
          <div className="flex min-w-0 flex-col items-center">
            <p className="text-2xl font-semibold text-muted-foreground sm:text-4xl">
              {course.name}
            </p>
            {s.requiresCode && s.checkInCode ? (
              <p
                className={cn(
                  "mt-6 font-mono leading-none font-bold tracking-[0.25em] tabular-nums",
                  showQr
                    ? "text-[5rem] sm:text-[8rem] xl:text-[10rem]"
                    : "text-[9rem] sm:text-[14rem]",
                )}
              >
                {s.checkInCode}
              </p>
            ) : (
              <p className="mt-6 text-4xl font-semibold sm:text-6xl">
                Check in now
              </p>
            )}
            <p
              className={cn(
                "mt-8 font-mono text-5xl font-semibold tabular-nums sm:text-7xl",
                remaining < 30_000 && "text-red-600 dark:text-red-400",
              )}
            >
              {live ? formatCountdown(remaining) : "Closed"}
            </p>
            <p className="mt-6 text-lg text-muted-foreground tabular-nums">
              {checkedIn} / {total} checked in
            </p>
          </div>
        </div>
      )}

      <AlertDialog
        open={confirmDelete.value}
        onOpenChange={(v) => (confirmDelete.value = v)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>
              Every record in it is removed and attendance rates are
              recalculated. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting.value}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={remove}
              disabled={deleting.value}
            >
              {deleting.value && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
