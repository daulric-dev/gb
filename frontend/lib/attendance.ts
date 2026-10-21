import { useEffect, useState } from "react";
import { ApiError, buildUrl } from "@/lib/api";
import type { AttendanceMethod, AttendanceStatus } from "@/lib/courses/types";

// ── Labels and colours ──────────────────────────────────────────────────────

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  "present",
  "late",
  "absent",
  "excused",
];

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  excused: "Excused",
};

export const ATTENDANCE_METHOD_LABEL: Record<AttendanceMethod, string> = {
  self: "Checked in",
  teacher: "Set by staff",
  auto: "Marked when closed",
  qr: "Scanned QR",
};

/**
 * Badge classes for a status; `null` is a student who has not checked in yet
 * while the session is open.
 */
export function statusColor(status: AttendanceStatus | null): string {
  switch (status) {
    case "present":
      return "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "late":
      return "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400";
    case "absent":
      return "border-transparent bg-red-500/15 text-red-700 dark:text-red-400";
    case "excused":
      return "border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-400";
    default:
      return "border-transparent bg-muted text-muted-foreground";
  }
}

export function statusLabel(status: AttendanceStatus | null): string {
  return status ? ATTENDANCE_STATUS_LABEL[status] : "Waiting";
}

/** Text colour for an attendance rate: >=90 green, >=75 amber, else red. */
export function rateColor(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) {
    return "text-muted-foreground";
  }
  if (rate >= 90) return "text-emerald-600 dark:text-emerald-400";
  if (rate >= 75) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "-";
  return `${Math.round(rate)}%`;
}

// ── Time ────────────────────────────────────────────────────────────────────

/** Milliseconds as `m:ss` (or `h:mm:ss` past an hour); never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

export function msUntil(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, t - now);
}

export function formatSessionDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** The current time, re-rendering every `intervalMs` while `active`. */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    // Catch up straight away after being inactive, then tick on the interval.
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs, active]);
  return now;
}

/** Milliseconds left until `closesAt`, ticking once a second. */
export function useCountdown(closesAt: string | null | undefined): number {
  const now = useNow(1000, !!closesAt);
  return msUntil(closesAt, now);
}

// ── Geolocation ─────────────────────────────────────────────────────────────

export interface Position {
  latitude: number;
  longitude: number;
  accuracy: number;
}

/** One high-accuracy fix from the browser, with a readable error message. */
export function getCurrentPosition(timeoutMs = 15_000): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("This browser cannot share its location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => reject(new Error(geolocationMessage(err))),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

function geolocationMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Location access was blocked. Allow it in your browser settings and try again.";
    case err.POSITION_UNAVAILABLE:
      return "Your location could not be found. Try again near a window or with Wi-Fi on.";
    case err.TIMEOUT:
      return "Finding your location took too long. Try again.";
    default:
      return "Could not get your location.";
  }
}

// ── Check-in errors ─────────────────────────────────────────────────────────

/** A readable message for a failed check-in. */
export function checkInErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return err.message && err.message !== "Too Many Requests"
        ? err.message
        : "Too many wrong codes. Ask your teacher to mark you.";
    }
    if (err.status === 409 || err.status === 400 || err.status === 403) {
      return err.message || "Could not check you in.";
    }
    if (err.status === 0) return err.message;
    return err.message || "Could not check you in.";
  }
  if (err instanceof Error) return err.message;
  return "Could not check you in.";
}

// ── Server-sent events ──────────────────────────────────────────────────────

export interface StreamHandlers {
  /** Called with the parsed `data` of each named event. */
  events: Record<string, (data: unknown) => void>;
  onOpen?: () => void;
  onError?: () => void;
}

/**
 * Open an SSE stream on an API path with cookies. Events arrive as
 * `event: <type>` + JSON `data`; a default `message` carrying `{type, data}`
 * is routed the same way. Returns a function that closes the stream.
 */
export function openStream(path: string, handlers: StreamHandlers): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    handlers.onError?.();
    return () => {};
  }
  let source: EventSource;
  try {
    source = new EventSource(buildUrl(path), { withCredentials: true });
  } catch {
    handlers.onError?.();
    return () => {};
  }

  for (const [type, handler] of Object.entries(handlers.events)) {
    source.addEventListener(type, (e) => {
      const data = parseJson((e as MessageEvent).data);
      if (data !== undefined) handler(data);
    });
  }
  source.addEventListener("message", (e) => {
    const msg = parseJson((e as MessageEvent).data) as
      | { type?: string; data?: unknown }
      | undefined;
    if (msg && typeof msg.type === "string") {
      handlers.events[msg.type]?.(msg.data);
    }
  });
  source.onopen = () => handlers.onOpen?.();
  source.onerror = () => handlers.onError?.();

  return () => source.close();
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
