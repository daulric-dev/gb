"use client";

import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { awayReasonLabel } from "@/lib/quiz-lockdown";
import type { SubmissionRow } from "./types";

function timeOf(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * One student's lockdown status in the roster: "Taking now" or "Away (why)",
 * how many times they left, and when they last did.
 */
export function LockdownPresence({
  submission,
}: {
  submission: SubmissionRow["submission"];
}) {
  if (!submission) return null;
  const switches = submission.tabSwitchCount ?? 0;
  const active = !!submission.isActiveAttempt;
  if (!active && switches === 0) return null;
  const lastAway = submission.lastAwayAt ? timeOf(submission.lastAwayAt) : null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      {active &&
        (submission.isAway ? (
          <Badge
            variant="outline"
            className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          >
            Away · {awayReasonLabel(submission.awayReason)}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          >
            Taking now
          </Badge>
        ))}
      <span
        className={
          switches > 0
            ? "font-medium text-amber-700 dark:text-amber-400"
            : "text-muted-foreground"
        }
      >
        Left {switches} {switches === 1 ? "time" : "times"}
        {lastAway && switches > 0 ? ` · last at ${lastAway}` : ""}
      </span>
    </div>
  );
}

/** A line above the roster: who is in the quiz now, and a manual refresh. */
export function LockdownMonitorSummary({
  rows,
  refreshing,
  onRefreshAction,
}: {
  rows: SubmissionRow[];
  refreshing: boolean;
  onRefreshAction: () => void;
}) {
  const active = rows.filter((r) => r.submission?.isActiveAttempt);
  const away = active.filter((r) => r.submission?.isAway).length;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 shrink-0 text-primary" />
        <span>
          Lockdown quiz ·{" "}
          {active.length === 0
            ? "No one is taking it right now"
            : `${active.length} taking now${away ? `, ${away} away` : ""}`}
          {active.length > 0 && (
            <span className="text-muted-foreground"> · updates every 10s</span>
          )}
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onRefreshAction}
        disabled={refreshing}
      >
        {refreshing ? (
          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-1.5 size-3.5" />
        )}
        Refresh
      </Button>
    </div>
  );
}
