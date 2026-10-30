import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * The active school's upload limit (GET /schools/current/upload-limit), to
 * refuse an oversized file before asking for a ticket. The server still
 * decides: the ticket's `maxBytes` and its 400 are authoritative.
 */
export interface UploadLimit {
  uploadLimitBytes: number;
  uploadLimitMb: number;
  /** The school's own setting; null follows the platform default. */
  maxUploadMb: number | null;
  platformMaxMb: number;
  platformDefaultMb: number;
}

/** Whole MB, as the limit is set: 10485760 → "10MB". */
export function formatMb(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))}MB`;
}

/** The error to show for a file over `limitBytes`, or null when it fits. */
export function uploadSizeError(
  sizeBytes: number | null | undefined,
  limitBytes: number | null | undefined,
): string | null {
  if (!limitBytes || !sizeBytes || sizeBytes <= limitBytes) return null;
  return `File must be ${formatMb(limitBytes)} or smaller`;
}

/** Loads the limit once per mount; null until it arrives (or if it fails). */
export function useUploadLimit(): UploadLimit | null {
  const [limit, setLimit] = useState<UploadLimit | null>(null);
  useEffect(() => {
    let live = true;
    api<UploadLimit>("/schools/current/upload-limit")
      .then((res) => {
        if (live) setLimit(res);
      })
      .catch(() => {
        // No pre-check then; the ticket request still refuses a large file.
      });
    return () => {
      live = false;
    };
  }, []);
  return limit;
}
