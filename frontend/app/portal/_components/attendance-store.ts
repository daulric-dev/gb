import { signal } from "@preact/signals-react";
import { api } from "@/lib/api";
import { openStream } from "@/lib/attendance";
import type { PortalOpenAttendance } from "@/lib/courses/types";

/**
 * Open attendance sessions for the signed-in student, kept fresh by polling
 * every 20 s plus the portal SSE stream. Started by the check-in banner in the
 * portal layout; pages read `openAttendance` directly.
 */
export const openAttendance = signal<PortalOpenAttendance[]>([]);

const POLL_MS = 20_000;

let users = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let closeStream: (() => void) | null = null;

export async function refreshOpenAttendance() {
  try {
    openAttendance.value = await api<PortalOpenAttendance[]>(
      "/portal/me/attendance/open",
    );
  } catch {
    // Non-fatal: keep what we had until the next poll.
  }
}

export function upsertOpenAttendance(entry: PortalOpenAttendance) {
  const rest = openAttendance.value.filter((s) => s.sessionId !== entry.sessionId);
  openAttendance.value = [...rest, entry].sort(
    (a, b) => +new Date(a.closesAt) - +new Date(b.closesAt),
  );
}

export function removeOpenAttendance(sessionId: string) {
  openAttendance.value = openAttendance.value.filter(
    (s) => s.sessionId !== sessionId,
  );
}

/** Start syncing; returns the matching stop. Reference counted. */
export function startAttendanceSync(): () => void {
  users += 1;
  if (users === 1) {
    void refreshOpenAttendance();
    pollTimer = setInterval(() => void refreshOpenAttendance(), POLL_MS);
    closeStream = openStream("/portal/me/stream", {
      events: {
        "attendance.opened": (data) => {
          const entry = data as PortalOpenAttendance;
          if (entry?.sessionId) upsertOpenAttendance(entry);
        },
        "attendance.closed": (data) => {
          const d = data as { sessionId?: string };
          if (d?.sessionId) removeOpenAttendance(d.sessionId);
        },
      },
    });
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    users -= 1;
    if (users > 0) return;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    closeStream?.();
    closeStream = null;
    openAttendance.value = [];
  };
}
