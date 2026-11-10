"use client";

import { useCallback, useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  addDays,
  daysIn,
  formatDay,
  groupByDay,
  OCCURRENCE_STATUS_LABEL,
  timeRange,
  type OccurrenceRange,
  type TimetableOccurrence,
} from "@/lib/timetable";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** The student's week (GET /portal/me/timetable), Monday to Sunday. */
export default function PortalTimetablePage() {
  useSignals();
  const data = useSignal<OccurrenceRange | null>(null);
  const from = useSignal<string | null>(null);
  const error = useSignal<string | null>(null);
  const loading = useSignal(true);

  const load = useCallback(async () => {
    loading.value = true;
    try {
      const q = from.value ? `?from=${from.value}&to=${addDays(from.value, 6)}` : "";
      const r = await api<OccurrenceRange>(`/portal/me/timetable${q}`);
      data.value = r;
      from.value = r.from;
      error.value = null;
    } catch (err) {
      error.value = userMessage(err, "Could not load your timetable");
    } finally {
      loading.value = false;
    }
  }, [data, from, error, loading]);

  useEffect(() => {
    void load();
  }, [load]);

  function shift(days: number) {
    if (!from.value) return;
    from.value = addDays(from.value, days);
    void load();
  }

  const d = data.value;
  const byDay = d ? groupByDay(d.occurrences) : new Map<string, TimetableOccurrence[]>();
  // Weekdays always; a weekend only when something is on.
  const days = d
    ? daysIn(d.from, d.to).filter((day, i) => i < 5 || byDay.has(day))
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Timetable</h1>
          <p className="mt-1 text-muted-foreground" aria-live="polite">
            {d ? `${formatDay(d.from)} – ${formatDay(d.to, { year: true })}` : "Your classes this week"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => shift(-7)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon" aria-label="Next week" onClick={() => shift(7)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {error.value ? (
        <p role="alert" className="text-sm text-destructive">
          {error.value}
        </p>
      ) : loading.value && !d ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {days.map((day) => {
            const list = byDay.get(day) ?? [];
            const isToday = d?.today === day;
            return (
              <Card key={day} className={cn(isToday && "border-primary")}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {formatDay(day)}
                    {isToday && <span className="sr-only"> (today)</span>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {list.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No classes</p>
                  ) : (
                    <ul className="space-y-2">
                      {list.map((o) => (
                        <li
                          key={`${o.entryId}|${o.occursOn}`}
                          className={cn("rounded-md border p-2", o.status === "cancelled" && "opacity-70")}
                        >
                          <p className={cn("text-xs tabular-nums text-muted-foreground", o.status === "cancelled" && "line-through")}>
                            {timeRange(o.startMinute, o.endMinute)} · {o.periodName}
                          </p>
                          <p className="text-sm font-medium">{o.courseName}</p>
                          <p className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="size-3" aria-hidden />
                            {o.roomName ?? "No room"}
                          </p>
                          {o.status !== "scheduled" && (
                            <Badge variant={o.status === "cancelled" ? "destructive" : "outline"} className="mt-1">
                              {OCCURRENCE_STATUS_LABEL[o.status]}
                            </Badge>
                          )}
                          {o.note && <p className="mt-1 text-xs">{o.note}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
