import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useFocusEffect } from "expo-router";

export const LIVE_ROSTER_POLL_MS = 10_000;

/**
 * Re-reads the submissions roster every ~10s while someone is sitting a
 * lockdown quiz, so "Taking now" / "Away" stay current. Polls only while the
 * screen is focused, the app is in the foreground and at least one attempt
 * is active; stops otherwise. Mirrors the web app's useLiveRoster.
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

  useFocusEffect(
    useCallback(() => {
      if (!enabled || !hasActiveAttempt) return;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;

      const schedule = () => {
        if (stopped || AppState.currentState !== "active") return;
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

      const onChange = (next: AppStateStatus) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (stopped || next !== "active") return;
        // Back in the app: catch up now, then carry on polling.
        void Promise.resolve(refreshRef.current())
          .catch(() => undefined)
          .finally(schedule);
      };

      const sub = AppState.addEventListener("change", onChange);
      schedule();
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        sub.remove();
      };
    }, [enabled, hasActiveAttempt, intervalMs]),
  );
}
