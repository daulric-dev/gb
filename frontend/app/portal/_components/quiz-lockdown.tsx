"use client";

import { Loader2, Maximize, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { QuizLockdownState } from "@/lib/quiz-lockdown";

/** The rules screen a lockdown quiz shows before an attempt starts. */
export function LockdownStartCard({
  details,
  startLabel,
  busy,
  onStartAction,
}: {
  /** Time limit and attempts, as the ordinary start card words them. */
  details: string;
  startLabel: string;
  busy: boolean;
  onStartAction: () => void;
}) {
  return (
    <Card className="border-amber-500/40">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500" />
          <div className="space-y-1">
            <p className="text-sm font-medium">This quiz is monitored</p>
            <p className="text-sm text-muted-foreground">
              Stay in fullscreen and on this tab until you submit. Your teacher
              sees when you leave the quiz and how many times.
            </p>
          </div>
        </div>
        <ul className="list-disc space-y-1 pl-9 text-sm text-muted-foreground">
          <li>The quiz opens in fullscreen when you start.</li>
          <li>
            Switching tabs, opening another window or app, or leaving
            fullscreen is reported to your teacher.
          </li>
          <li>Copy, paste and right-click are turned off in the quiz.</li>
          <li>
            Your browser cannot be fully locked; this only notifies your
            teacher. If your device does not support fullscreen, the quiz
            still works and leaving the tab is still reported.
          </li>
        </ul>
        <p className="text-sm text-muted-foreground">{details}</p>
        <Button onClick={onStartAction} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Maximize className="mr-2 size-4" />
          )}
          {startLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

const AWAY_MESSAGE: Record<string, string> = {
  tab_hidden: "You switched away from the quiz tab.",
  window_blur: "You clicked away from the quiz window.",
  fullscreen_exit: "You left fullscreen.",
};

/** Covers the quiz while the student is away, until they return. */
export function LockdownOverlay({
  state,
  timeLeft,
  onReturnAction,
}: {
  state: QuizLockdownState;
  /** "m:ss" left on the clock, when the quiz is timed. */
  timeLeft?: string | null;
  onReturnAction: () => void;
}) {
  const message = state.reason
    ? AWAY_MESSAGE[state.reason]
    : "You left the quiz.";
  const needsFullscreen = state.fullscreenSupported && !state.inFullscreen;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="quiz-lockdown-title"
      aria-describedby="quiz-lockdown-body"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm"
    >
      <Card className="w-full max-w-md border-amber-500/40">
        <CardContent className="space-y-4 py-6 text-center">
          <ShieldAlert className="mx-auto size-10 text-amber-600 dark:text-amber-500" />
          <div className="space-y-1">
            <p id="quiz-lockdown-title" className="text-lg font-semibold">
              Return to your quiz
            </p>
            <p id="quiz-lockdown-body" className="text-sm text-muted-foreground">
              {message} Your teacher has been notified. Your answers are saved
              {timeLeft ? " and the timer is still running" : ""}.
            </p>
          </div>
          {timeLeft && (
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {timeLeft}
            </p>
          )}
          <Button className="w-full" autoFocus onClick={onReturnAction}>
            {needsFullscreen && <Maximize className="mr-2 size-4" />}
            {needsFullscreen ? "Return to quiz in fullscreen" : "Return to quiz"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
