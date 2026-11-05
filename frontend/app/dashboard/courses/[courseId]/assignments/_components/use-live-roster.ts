"use client";

import { useEffect, useRef } from "react";

export const LIVE_ROSTER_POLL_MS = 10_000;

/**
 * Re-reads the submissions roster every ~10s while someone is sitting a
 * lockdown quiz, so "Taking now" / "Away" stay current. Polls only while the
 * page is visible and at least one attempt is active; stops otherwise.
 */
export function useLiveRoster({
  enabled,
  hasActiveAttempt,
  refresh,
  intervalMs = LIVE_ROSTER_POLL_MS,
}: {
  enabled: boolean;
  hasActiveAttempt: boolean;
  refresh: () => Promise<unknown> | void;
  intervalMs?: number;
}) {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled || !hasActiveAttempt) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const schedule = () => {
      if (stopped || document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        timer = null;
        try {
          await refreshRef.current();
        } catch {
          // The next tick tries again.
        }
        schedule();
      }, intervalMs);
    };

    const onVisibility = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (document.visibilityState === "visible") {
        // Back on the page: catch up now, then carry on polling.
        void Promise.resolve(refreshRef.current())
          .catch(() => undefined)
          .finally(schedule);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, hasActiveAttempt, intervalMs]);
}
