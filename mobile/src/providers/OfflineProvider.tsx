import { useEffect, useRef, type ReactNode } from "react";
import { AppState } from "react-native";
import { api, apiServerOrigin } from "@/lib/api";
import {
  connectivity,
  probeDelayMs,
  subscribeConnectivity,
} from "@/lib/connectivity";
import {
  draftQueue,
  rememberProfile,
  setOfflineScope,
} from "@/lib/offline-store";
import { prefetchForOffline, runDraftSync } from "@/lib/offline-sync";
import { useAuth } from "@/providers/AuthProvider";

/**
 * Offline mode for students (see mobile/README.md, "Offline mode"):
 *
 * - sets whose offline data is in use (server + student id; staff get none);
 * - while the server can't be reached, probes it (5s doubling to 60s, and on
 *   returning to the foreground); `api()` flips the app back online on any
 *   answer;
 * - back online: re-reads the profile, sends queued drafts in order (retrying
 *   with backoff) and refreshes the saved copies in the background.
 */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const { profile, refreshSilently } = useAuth();
  const student = profile?.account_type === "student" ? profile : null;
  const userId = student?.id ?? null;

  useEffect(() => {
    const server = apiServerOrigin();
    setOfflineScope(userId && server ? { server, userId } : null);
  }, [userId]);

  // So the app can open without a signal next time.
  useEffect(() => {
    const server = apiServerOrigin();
    if (student && server) rememberProfile(server, student);
  }, [student]);

  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef(refreshSilently);
  refreshRef.current = refreshSilently;

  useEffect(() => {
    if (!userId) return;
    let live = true;

    const clearRetry = () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
    };

    const sync = async () => {
      if (!live || connectivity() === "offline") return;
      clearRetry();
      const result = await runDraftSync()?.catch(() => null);
      if (!live) return;
      clearRetry();
      if (result?.retryAt) {
        retryTimer.current = setTimeout(
          () => void sync(),
          Math.max(1_000, result.retryAt - Date.now()),
        );
      }
      if (connectivity() === "online") void prefetchForOffline().catch(() => {});
    };

    // Probing while offline.
    let probes = 0;
    let probeTimer: ReturnType<typeof setTimeout> | null = null;
    const probe = () => {
      if (probeTimer) clearTimeout(probeTimer);
      probeTimer = null;
      if (!live || connectivity() === "online") return;
      void api("/app/version", { skipAuthRedirect: true })
        .catch(() => undefined)
        .finally(() => {
          if (!live || connectivity() === "online") return;
          probeTimer = setTimeout(probe, probeDelayMs(probes++));
        });
    };

    const offConnectivity = subscribeConnectivity((status) => {
      if (status === "offline") {
        probes = 0;
        clearRetry();
        probeTimer = setTimeout(probe, probeDelayMs(probes++));
      } else {
        if (probeTimer) clearTimeout(probeTimer);
        probeTimer = null;
        void refreshRef.current();
        void sync();
      }
    });

    // A new draft: try to send it straight away.
    let lastUnsent = -1;
    const offQueue = draftQueue.subscribe(() => {
      const waiting = draftQueue
        .unsent()
        .filter((i) => i.kind === "quiz_answers" && i.state === "saved_offline")
        .length;
      if (waiting > 0 && waiting !== lastUnsent) void sync();
      lastUnsent = waiting;
    });

    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (connectivity() === "offline") {
        probes = 0;
        probe();
      } else void sync();
    });

    if (connectivity() === "offline") probe();
    else void sync();

    return () => {
      live = false;
      clearRetry();
      if (probeTimer) clearTimeout(probeTimer);
      offConnectivity();
      offQueue();
      appState.remove();
    };
  }, [userId]);

  return <>{children}</>;
}
