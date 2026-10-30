import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";

/**
 * The active school's upload limit (GET /schools/current/upload-limit).
 *
 * Used to refuse an oversized file before asking for a ticket. The server
 * still decides: the ticket's `maxBytes` and its 400 are authoritative.
 */
export interface UploadLimit {
  uploadLimitBytes: number;
  uploadLimitMb: number;
  /** The school's own setting; null follows the platform default. */
  maxUploadMb: number | null;
  platformMaxMb: number;
  platformDefaultMb: number;
}

export const UPLOAD_LIMIT_PATH = "/schools/current/upload-limit";

/** The error to show for a file over `limitBytes`, or null when it fits. */
export function uploadSizeError(
  sizeBytes: number,
  limitBytes: number | null | undefined,
): string | null {
  if (!limitBytes || sizeBytes <= limitBytes) return null;
  return `File must be ${formatMb(limitBytes)} or smaller`;
}

/** Whole MB, as the limit is set: 10485760 → "10MB". */
export function formatMb(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))}MB`;
}

/** Slider stops, in MB: fine steps where limits are small, coarse up to 1 GB. */
const LIMIT_STOPS_MB = [1, 5, 10, 25, 50, 100, 250, 500, 750, 1024];

/**
 * The values the limit slider snaps to: the fixed stops up to `max`, plus
 * `max` itself and the school's current value, so neither is unreachable.
 */
export function uploadLimitStops(max: number, current?: number | null): number[] {
  const stops = new Set(LIMIT_STOPS_MB.filter((mb) => mb <= max));
  stops.add(max);
  if (current && current >= 1 && current <= max) stops.add(current);
  return [...stops].sort((a, b) => a - b);
}

/** A limit as people read it: 100 → "100 MB", 1024 → "1 GB". */
export function formatLimitMb(mb: number): string {
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;
}

/** Loads the limit once per mount; null until it arrives (or if it fails). */
export function useUploadLimit() {
  useSignals();
  const limit = useSignal<UploadLimit | null>(null);
  useEffect(() => {
    let live = true;
    api<UploadLimit>(UPLOAD_LIMIT_PATH)
      .then((res) => {
        if (live) limit.value = res;
      })
      .catch(() => {
        // No pre-check then; the ticket request still refuses a large file.
      });
    return () => {
      live = false;
    };
  }, [limit]);
  return limit.value;
}
