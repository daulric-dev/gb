"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import { toast } from "sonner";
import {
  createQuizLockdown,
  exitFullscreen,
  INACTIVE_LOCKDOWN_STATE,
  sendQuizPresence,
  type QuizLockdownController,
  type QuizLockdownState,
} from "@/lib/quiz-lockdown";

/**
 * Monitors a lockdown quiz attempt while `enabled`: a presence heartbeat,
 * an immediate "away" when the student leaves the tab, the window or
 * fullscreen, and "present" when they come back. Turn `enabled` off on
 * submit or expiry; everything stops then, and on unmount.
 */
export function useQuizLockdown({
  activityId,
  enabled,
}: {
  activityId: string;
  enabled: boolean;
}) {
  const [state, setState] = useState<QuizLockdownState>(
    INACTIVE_LOCKDOWN_STATE,
  );
  const controller = useRef<QuizLockdownController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Leaving the page mid-quiz: drop fullscreen. Deferred so a dev-mode
      // remount (which sets `mounted` again) does not kick the student out.
      setTimeout(() => {
        if (!mounted.current) exitFullscreen();
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !activityId) return;
    const lockdown = createQuizLockdown({
      send: (payload) => sendQuizPresence(activityId, payload),
      onChange: setState,
    });
    controller.current = lockdown;
    return () => {
      lockdown.stop();
      if (controller.current === lockdown) controller.current = null;
    };
  }, [activityId, enabled]);

  // Submitted or out of time: leave fullscreen with the attempt.
  const wasEnabled = useRef(false);
  useEffect(() => {
    if (wasEnabled.current && !enabled) exitFullscreen();
    wasEnabled.current = enabled;
  }, [enabled]);

  const returnToQuiz = useCallback(() => {
    void controller.current?.returnToQuiz();
  }, []);

  /** Spread on the quiz area: no context menu, copy, cut or paste in it. */
  const guardProps = useMemo(() => {
    const block = (event: SyntheticEvent) => {
      if (!enabled) return;
      event.preventDefault();
      toast.info("Copy, paste and right-click are turned off for this quiz.", {
        id: "quiz-lockdown-clipboard",
      });
    };
    return {
      onContextMenu: block,
      onCopy: block,
      onCut: block,
      onPaste: block,
    };
  }, [enabled]);

  const current = enabled ? state : INACTIVE_LOCKDOWN_STATE;
  return {
    state: current,
    /** Show the blocking overlay. */
    showOverlay: current.active && (current.away || current.needsReturn),
    returnToQuiz,
    guardProps,
  };
}
