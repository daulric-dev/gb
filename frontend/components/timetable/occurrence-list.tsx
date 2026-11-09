"use client";

import Link from "next/link";
import { toast } from "sonner";
import { CalendarX, MapPin, MoveRight, Radio, Undo2 } from "lucide-react";
import { userMessage } from "@/lib/errors";
import {
  formatDay,
  OCCURRENCE_STATUS_LABEL,
  timeRange,
  type TimetableOccurrence,
} from "@/lib/timetable";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { restoreOccurrence, type OccurrenceAction } from "./occurrence-dialog";

const STATUS_CLASS: Record<TimetableOccurrence["status"], string> = {
  scheduled: "",
  cancelled: "border-transparent bg-red-500/15 text-red-700 dark:text-red-400",
  moved: "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

/**
 * One list of periods (a day or a week). `showCourse` for a member of
 * staff's own day across courses; `onAction` shows cancel / move buttons,
 * which only work before the period's attendance opens.
 */
export function OccurrenceList({
  occurrences,
  showCourse = true,
  showDate = false,
  now = Date.now(),
  onAction,
  onChangedAction,
}: {
  occurrences: TimetableOccurrence[];
  showCourse?: boolean;
  showDate?: boolean;
  now?: number;
  onAction?: (o: TimetableOccurrence, action: OccurrenceAction) => void;
  onChangedAction?: () => void;
}) {
  async function restore(o: TimetableOccurrence) {
    try {
      await restoreOccurrence(o);
      toast.success("Period restored");
      onChangedAction?.();
    } catch (err) {
      toast.error(userMessage(err, "Could not restore the period"));
    }
  }

  return (
    <ul className="divide-y rounded-lg border">
      {occurrences.map((o) => {
        const live = Date.parse(o.startsAt) <= now && now < Date.parse(o.endsAt);
        const over = Date.parse(o.endsAt) <= now;
        const handled = !!o.session;
        const sessionHref =
          o.session?.id ? `/dashboard/courses/${o.courseId}/attendance/${o.session.id}` : null;
        const label = `${o.periodName}, ${timeRange(o.startMinute, o.endMinute)}${
          showCourse ? `, ${o.courseName}` : ""
        }`;
        return (
          <li
            key={`${o.entryId}|${o.occursOn}`}
            className={cn(
              "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3",
              o.status === "cancelled" && "opacity-70",
            )}
            aria-label={label}
          >
            <div className="w-28 shrink-0 tabular-nums">
              {showDate && <p className="text-xs text-muted-foreground">{formatDay(o.date)}</p>}
              <p className={cn("text-sm font-medium", o.status === "cancelled" && "line-through")}>
                {timeRange(o.startMinute, o.endMinute)}
              </p>
              <p className="text-xs text-muted-foreground">{o.periodName}</p>
            </div>
            <div className="min-w-0 flex-1">
              {showCourse && (
                <p className="truncate text-sm font-medium">
                  {o.courseName}
                  {o.courseCode ? <span className="text-muted-foreground"> · {o.courseCode}</span> : null}
                </p>
              )}
              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                <MapPin className="size-3" aria-hidden />
                {o.roomName ?? "No room"}
                {o.status === "moved" && o.date !== o.occursOn && (
                  <span> · moved from {formatDay(o.occursOn)}</span>
                )}
              </p>
              {o.note && <p className="truncate text-xs">{o.note}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {o.status !== "scheduled" && (
                <Badge className={STATUS_CLASS[o.status]}>{OCCURRENCE_STATUS_LABEL[o.status]}</Badge>
              )}
              {live && o.status !== "cancelled" && (
                <Badge className="border-transparent bg-emerald-500 text-white">Now</Badge>
              )}
              {o.session?.state === "skipped" && (
                <Badge variant="outline" title={o.session.reason ?? undefined}>
                  No automatic session
                </Badge>
              )}
              {sessionHref && (
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href={sessionHref} />}>
                  <Radio className="mr-1.5 size-3.5" aria-hidden />
                  Attendance
                </Button>
              )}
              {onAction && !handled && !over && o.status === "scheduled" && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => onAction(o, "move")}>
                    <MoveRight className="mr-1.5 size-3.5" aria-hidden />
                    Move
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onAction(o, "cancel")}>
                    <CalendarX className="mr-1.5 size-3.5" aria-hidden />
                    Cancel
                  </Button>
                </>
              )}
              {onAction && !handled && !over && o.status !== "scheduled" && (
                <Button size="sm" variant="ghost" onClick={() => void restore(o)}>
                  <Undo2 className="mr-1.5 size-3.5" aria-hidden />
                  Restore
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
