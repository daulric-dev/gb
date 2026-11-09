"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { CalendarClock, ChevronLeft, ChevronRight, Settings } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { useNow } from "@/lib/attendance";
import {
  addDays,
  formatDay,
  type OccurrenceRange,
  type Room,
  type TimetableOccurrence,
  type TimetableSetup,
} from "@/lib/timetable";
import { useOptionalCan } from "@/providers/PermissionsProvider";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { TimeZoneNotice } from "@/components/timetable/time-zone-notice";
import { OccurrenceList } from "@/components/timetable/occurrence-list";
import { OccurrenceDialog, type OccurrenceAction } from "@/components/timetable/occurrence-dialog";

/**
 * A member of staff's own periods, one day at a time (GET /timetable/me):
 * when each starts, where, whether attendance opened, and cancel / move
 * before it does.
 */
export default function MyTimetablePage() {
  useSignals();
  const can = useOptionalCan();
  const now = useNow(30_000);
  const day = useSignal<string | null>(null);
  const data = useSignal<OccurrenceRange | null>(null);
  const loading = useSignal(true);
  const error = useSignal<string | null>(null);
  const rooms = useSignal<Room[] | undefined>(undefined);
  const editing = useSignal<{ o: TimetableOccurrence; action: OccurrenceAction } | null>(null);

  const load = useCallback(async () => {
    loading.value = true;
    try {
      const q = day.value ? `?from=${day.value}&to=${day.value}` : "";
      const r = await api<OccurrenceRange>(`/timetable/me${q}`);
      data.value = r;
      if (!day.value) day.value = r.from;
      error.value = null;
    } catch (err) {
      error.value = userMessage(err, "Could not load your timetable");
    } finally {
      loading.value = false;
    }
  }, [day, data, loading, error]);

  useEffect(() => {
    void load();
    api<TimetableSetup>("/schools/current/timetable")
      .then((s) => (rooms.value = s.rooms))
      .catch(() => (rooms.value = undefined));
  }, [load, rooms]);

  function go(delta: number) {
    const base = day.value ?? data.value?.today;
    if (!base) return;
    day.value = addDays(base, delta);
    void load();
  }

  function today() {
    if (!data.value) return;
    day.value = data.value.today;
    void load();
  }

  const current = day.value ?? data.value?.from ?? null;
  const isToday = !!data.value && current === data.value.today;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Timetable"
        description="Your periods for the day. Attendance opens automatically when each one starts."
        action={
          can("school", "update") ? (
            <Button variant="outline" nativeButton={false} render={<Link href="/dashboard/settings/timetable" />}>
              <Settings className="mr-2 size-4" aria-hidden />
              Timetable setup
            </Button>
          ) : undefined
        }
      />

      <TimeZoneNotice timeZoneSet={data.value?.timeZoneSet} />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle aria-live="polite">
              {current ? formatDay(current, { year: true }) : "Today"}
              {isToday ? " · Today" : ""}
            </CardTitle>
            <CardDescription>
              {data.value?.timeZone ? `Times in ${data.value.timeZone}` : null}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => go(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" onClick={today} disabled={isToday}>
              Today
            </Button>
            <Button variant="outline" size="icon" aria-label="Next day" onClick={() => go(1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading.value && !data.value ? (
            <Skeleton className="h-40 w-full" />
          ) : error.value ? (
            <p role="alert" className="text-sm text-destructive">
              {error.value}
            </p>
          ) : (data.value?.occurrences.length ?? 0) === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarClock />
                </EmptyMedia>
                <EmptyTitle>No periods</EmptyTitle>
                <EmptyDescription>
                  Nothing is timetabled for you on this day. Add periods from a course&apos;s Timetable tab.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <OccurrenceList
              occurrences={data.value!.occurrences}
              now={now}
              onAction={(o, action) => (editing.value = { o, action })}
              onChangedAction={() => void load()}
            />
          )}
        </CardContent>
      </Card>

      {editing.value && (
        <OccurrenceDialog
          occurrence={editing.value.o}
          action={editing.value.action}
          rooms={rooms.value}
          onOpenChangeAction={(open) => {
            if (!open) editing.value = null;
          }}
          onDoneAction={() => void load()}
        />
      )}
    </div>
  );
}
