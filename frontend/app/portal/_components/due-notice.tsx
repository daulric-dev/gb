import { CalendarClock, Lock } from "lucide-react";
import { formatDue } from "@/lib/courses/format";
import { pastDueMessage, studentDueAt } from "./work-types";

/**
 * Above a piece of work: that the student was given more time, or that it
 * has closed to them. Renders nothing for undated or ordinary work.
 */
export function DueDateNotice({
  work,
}: {
  work: {
    kind: string;
    status: string;
    dueAt: string | null;
    effectiveDueAt?: string | null;
    hasExtension?: boolean;
    isClosed?: boolean;
    isLate?: boolean;
    lateUntil?: string | null;
    latePenaltyMode?: string | null;
    submission: { status: string } | null;
  };
}) {
  if (work.kind === "offline") return null;
  const due = studentDueAt(work);

  if (work.status === "published" && work.isClosed) {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm"
      >
        <Lock className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <p>{pastDueMessage(due)}.</p>
      </div>
    );
  }

  if (work.status === "published" && work.isLate && work.lateUntil) {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm"
      >
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <p>
          <span className="font-medium">Late submission.</span> Past due ({formatDue(due)}). Work is accepted until {formatDue(work.lateUntil)}
          {work.latePenaltyMode && work.latePenaltyMode !== "none" ? " (late penalty applies)" : ""}.
        </p>
      </div>
    );
  }

  if (work.hasExtension) {
    return (
      <div className="flex items-start gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p>
          <span className="font-medium">Extended.</span> Your teacher gave you
          until {formatDue(due)}
          {work.dueAt ? ` (originally ${formatDue(work.dueAt)})` : ""}.
        </p>
      </div>
    );
  }

  return null;
}
