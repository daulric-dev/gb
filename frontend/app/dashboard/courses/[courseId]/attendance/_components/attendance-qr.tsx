"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { AttendanceQrFrame } from "@/lib/courses/types";
import { cn } from "@/lib/utils";

/** Wait this long past `rotatesAt` so the server is surely on the next window. */
const ROTATE_SLACK_MS = 150;
const RETRY_MS = 3000;

export interface QrState {
  frame: AttendanceQrFrame | null;
  /** Local clock time the next frame is due, for the drain bar. */
  nextAt: number;
  /** Fetched at, local clock. */
  fetchedAt: number;
  /** The last fetch failed and another is scheduled. */
  retrying: boolean;
  /** The session has no QR (opened before QR existed); stop asking. */
  unavailable: boolean;
}

const EMPTY: QrState = {
  frame: null,
  nextAt: 0,
  fetchedAt: 0,
  retrying: false,
  unavailable: false,
};

/**
 * The rotating QR frame for an open session: fetched on mount and again just
 * after each `rotatesAt`; retried every 3 s on failure; stopped when `active`
 * goes false. A 409 "closed" calls `onClosedAction` so the page can re-read.
 */
export function useQrFrame(
  sessionPath: string,
  active: boolean,
  onClosedAction?: () => void,
): QrState {
  const [state, setState] = useState<QrState>(EMPTY);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fetchFrame = async () => {
      try {
        const frame = await api<AttendanceQrFrame>(`${sessionPath}/qr`);
        if (cancelled) return;
        const now = Date.now();
        const rotatesAt = new Date(frame.rotatesAt).getTime();
        const windowMs = frame.windowMs > 0 ? frame.windowMs : 15_000;
        // Clamp against clock skew between this machine and the server: never
        // hammer it, and never hold a frame longer than one window.
        const delay = Number.isNaN(rotatesAt)
          ? windowMs
          : Math.min(
              Math.max(rotatesAt - now + ROTATE_SLACK_MS, 500),
              windowMs + ROTATE_SLACK_MS,
            );
        setState({
          frame,
          fetchedAt: now,
          nextAt: now + delay,
          retrying: false,
          unavailable: false,
        });
        timer = setTimeout(() => void fetchFrame(), delay);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 409) {
          if (/closed/i.test(err.message)) {
            onClosedAction?.();
            return;
          }
          setState({ ...EMPTY, unavailable: true });
          return;
        }
        setState((s) => ({ ...s, retrying: true }));
        timer = setTimeout(() => void fetchFrame(), RETRY_MS);
      }
    };

    void fetchFrame();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionPath, active, onClosedAction]);

  return active ? state : EMPTY;
}

export const QR_CAPTION = "Scan with your phone camera or the GradeBook app";

/**
 * The QR itself: black on white with a quiet zone in every theme (phone
 * cameras struggle with inverted codes), plus a bar that empties until the
 * next rotation. Sized by its container: it fills the width given.
 */
export function AttendanceQr({
  state,
  className,
}: {
  state: QrState;
  className?: string;
}) {
  const { frame } = state;
  const windowMs =
    frame?.windowMs && frame.windowMs > 0 ? frame.windowMs : 15_000;
  const remaining = Math.max(0, state.nextAt - state.fetchedAt);
  const elapsed = Math.max(0, windowMs - remaining);

  return (
    <div className={cn("w-full", className)}>
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/10">
        {frame ? (
          <QRCodeSVG
            value={frame.url}
            size={512}
            level="M"
            marginSize={4}
            bgColor="#ffffff"
            fgColor="#000000"
            title="Attendance check-in QR code"
            className={cn(
              "block size-full transition-opacity",
              state.retrying && "opacity-60",
            )}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-neutral-500">
            {state.unavailable ? (
              <p className="px-6 text-center text-sm">
                This session was opened without a QR code. Students can still
                check in with the code.
              </p>
            ) : (
              <Loader2
                className="size-8 animate-spin"
                aria-label="Loading QR code"
              />
            )}
          </div>
        )}
      </div>
      <div
        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted"
        aria-hidden
      >
        {frame && (
          <div
            key={frame.token}
            className="h-full origin-left rounded-full bg-primary/60"
            style={{
              animationName: "qr-drain",
              animationDuration: `${windowMs}ms`,
              animationDelay: `-${elapsed}ms`,
              animationTimingFunction: "linear",
              animationFillMode: "forwards",
            }}
          />
        )}
      </div>
      {state.retrying && (
        <p className="mt-1 text-xs text-muted-foreground">Reconnecting…</p>
      )}
    </div>
  );
}
