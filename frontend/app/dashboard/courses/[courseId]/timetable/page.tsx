"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { CalendarClock, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { useNow } from "@/lib/attendance";
import {
  addDays,
  entryDayLabel,
  formatDay,
  timeRange,
  weekdayLabel,
  type CourseTimetable,
  type OccurrenceRange,
  type TimetableEntry,
  type TimetableOccurrence,
} from "@/lib/timetable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TimeZoneNotice } from "@/components/timetable/time-zone-notice";
import { OccurrenceList } from "@/components/timetable/occurrence-list";
import { OccurrenceDialog, type OccurrenceAction } from "@/components/timetable/occurrence-dialog";
import { useCourse } from "../_components/course-context";
import { SectionHeader } from "../_components/SectionHeader";

const UPCOMING_DAYS = 14;

interface Draft {
  id: string | null;
  periodId: string;
  day: string;
  roomId: string;
  validFrom: string;
  validTo: string;
}

export default function CourseTimetablePage() {
  useSignals();
  const { course } = useCourse();
  const now = useNow(30_000);
  const data = useSignal<CourseTimetable | null>(null);
  const upcoming = useSignal<OccurrenceRange | null>(null);
  const from = useSignal<string | null>(null);
  const loading = useSignal(true);
  const draft = useSignal<Draft | null>(null);
  const saving = useSignal(false);
  const formError = useSignal<string | null>(null);
  const editing = useSignal<{ o: TimetableOccurrence; action: OccurrenceAction } | null>(null);

  const loadUpcoming = useCallback(async () => {
    try {
      const q = from.value
        ? `?from=${from.value}&to=${addDays(from.value, UPCOMING_DAYS - 1)}`
        : "";
      const r = await api<OccurrenceRange>(`/courses/${course.id}/timetable/occurrences${q}`);
      if (!from.value) {
        // The API defaults to a week; widen to the two weeks shown here.
        from.value = r.from;
        upcoming.value = await api<OccurrenceRange>(
          `/courses/${course.id}/timetable/occurrences?from=${r.from}&to=${addDays(r.from, UPCOMING_DAYS - 1)}`,
        );
      } else {
        upcoming.value = r;
      }
    } catch (err) {
      toast.error(userMessage(err, "Could not load upcoming periods"));
    }
  }, [course.id, from, upcoming]);

  const load = useCallback(async () => {
    try {
      data.value = await api<CourseTimetable>(`/courses/${course.id}/timetable`);
    } catch (err) {
      toast.error(userMessage(err, "Could not load the timetable"));
    } finally {
      loading.value = false;
    }
    void loadUpcoming();
  }, [course.id, data, loading, loadUpcoming]);

  useEffect(() => {
    void load();
  }, [load]);

  const t = data.value;
  const rotating = !!t?.settings.cycleLength;
  const dayOptions: { value: string; label: string }[] = rotating
    ? Array.from({ length: t!.settings.cycleLength! }, (_, i) => ({
        value: `c${i + 1}`,
        label: `Day ${i + 1}`,
      }))
    : (t?.settings.schoolDays ?? [1, 2, 3, 4, 5]).map((d) => ({ value: `w${d}`, label: weekdayLabel(d) }));

  function openNew() {
    formError.value = null;
    draft.value = {
      id: null,
      periodId: t?.periods[0]?.id ?? "",
      day: dayOptions[0]?.value ?? "",
      roomId: "",
      validFrom: "",
      validTo: "",
    };
  }

  function openEdit(e: TimetableEntry) {
    formError.value = null;
    draft.value = {
      id: e.id,
      periodId: e.periodId,
      day: e.weekday !== null ? `w${e.weekday}` : `c${e.cycleDay}`,
      roomId: e.roomId ?? "",
      validFrom: e.validFrom ?? "",
      validTo: e.validTo ?? "",
    };
  }

  async function saveDraft(ev: React.FormEvent) {
    ev.preventDefault();
    const d = draft.value;
    if (!d) return;
    const n = Number(d.day.slice(1));
    const body = {
      periodId: d.periodId,
      weekday: d.day.startsWith("w") ? n : null,
      cycleDay: d.day.startsWith("c") ? n : null,
      roomId: d.roomId || null,
      validFrom: d.validFrom || null,
      validTo: d.validTo || null,
    };
    saving.value = true;
    formError.value = null;
    try {
      await api(
        d.id ? `/courses/${course.id}/timetable/entries/${d.id}` : `/courses/${course.id}/timetable/entries`,
        { method: d.id ? "PATCH" : "POST", body },
      );
      toast.success(d.id ? "Period updated" : "Period added");
      draft.value = null;
      await load();
    } catch (err) {
      formError.value = userMessage(err, "Could not save the period");
    } finally {
      saving.value = false;
    }
  }

  async function remove(e: TimetableEntry) {
    if (!window.confirm(`Remove ${e.periodName} on ${entryDayLabel(e)} from the timetable?`)) return;
    try {
      await api(`/courses/${course.id}/timetable/entries/${e.id}`, { method: "DELETE" });
      toast.success("Period removed");
      await load();
    } catch (err) {
      toast.error(userMessage(err, "Could not remove the period"));
    }
  }

  function shift(days: number) {
    if (!from.value) return;
    from.value = addDays(from.value, days);
    void loadUpcoming();
  }

  const header = (
    <SectionHeader
      title="Timetable"
      description="When this course meets. Attendance opens automatically at the start of each period, with the room's saved location."
      actions={
        t?.canEdit ? (
          <Button onClick={openNew} disabled={!t.periods.length}>
            <Plus className="mr-2 size-4" aria-hidden />
            Add period
          </Button>
        ) : undefined
      }
    />
  );

  if (loading.value) {
    return (
      <div className="space-y-5">
        {header}
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!t) return header;

  const periodTimes = (periodId: string, weekday: number | null) => {
    const p = t.periods.find((x) => x.id === periodId);
    if (!p) return "";
    const time = weekday !== null ? p.times.find((x) => x.weekday === weekday) : p.times[0];
    return time ? timeRange(time.startMinute, time.endMinute) : "No time that day";
  };

  return (
    <div className="space-y-6">
      {header}
      <TimeZoneNotice timeZoneSet={t.settings.timeZoneSet} />

      <Card>
        <CardHeader>
          <CardTitle>Weekly pattern</CardTitle>
          <CardDescription>
            {rotating
              ? `The school runs a ${t.settings.cycleLength}-day cycle.`
              : "The school runs a weekly timetable."}
            {t.term
              ? ` Periods run within ${t.term.name ?? "the term"}${
                  t.term.startDate && t.term.endDate
                    ? ` (${formatDay(t.term.startDate, { weekday: false })} – ${formatDay(t.term.endDate, { weekday: false, year: true })})`
                    : ""
                }.`
              : ""}
            {t.periods.length === 0 ? " The school has no bell schedule yet; an admin sets it up first." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {t.entries.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarClock />
                </EmptyMedia>
                <EmptyTitle>No periods yet</EmptyTitle>
                <EmptyDescription>
                  {t.canEdit ? "Add the periods this course meets in." : "The teacher has not set the timetable yet."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="divide-y rounded-lg border">
              {t.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {entryDayLabel(e)} · {e.periodName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {periodTimes(e.periodId, e.weekday)} · {e.roomName ?? "No room"}
                      {e.validFrom || e.validTo
                        ? ` · ${e.validFrom ? `from ${formatDay(e.validFrom, { weekday: false })}` : ""}${
                            e.validTo ? ` until ${formatDay(e.validTo, { weekday: false })}` : ""
                          }`
                        : ""}
                    </p>
                  </div>
                  {t.canEdit && (
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit ${entryDayLabel(e)} ${e.periodName}`}
                        onClick={() => openEdit(e)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${entryDayLabel(e)} ${e.periodName}`}
                        onClick={() => void remove(e)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Upcoming</CardTitle>
            <CardDescription>
              {from.value
                ? `${formatDay(from.value)} – ${formatDay(addDays(from.value, UPCOMING_DAYS - 1))}`
                : ""}
              {t.canEdit ? ". Cancel or move a single period before it starts." : ""}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" aria-label="Earlier" onClick={() => shift(-UPCOMING_DAYS)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Later" onClick={() => shift(UPCOMING_DAYS)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!upcoming.value ? (
            <Skeleton className="h-24 w-full" />
          ) : upcoming.value.occurrences.length === 0 ? (
            <p className="text-sm text-muted-foreground">No periods in these two weeks.</p>
          ) : (
            <OccurrenceList
              occurrences={upcoming.value.occurrences}
              showCourse={false}
              showDate
              now={now}
              onAction={t.canEdit ? (o, action) => (editing.value = { o, action }) : undefined}
              onChangedAction={() => void loadUpcoming()}
            />
          )}
        </CardContent>
      </Card>

      {draft.value && (
        <Dialog open onOpenChange={(open) => !open && (draft.value = null)}>
          <DialogContent className="sm:max-w-md">
            <form onSubmit={saveDraft} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{draft.value.id ? "Edit period" : "Add period"}</DialogTitle>
                <DialogDescription>
                  {rotating ? "Choose the cycle day" : "Choose the weekday"}, the period of the bell schedule and the room.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="tt-day">{rotating ? "Cycle day" : "Day"}</Label>
                  <NativeSelect
                    id="tt-day"
                    className="w-full"
                    value={draft.value.day}
                    onChange={(e) => (draft.value = { ...draft.value!, day: e.target.value })}
                  >
                    {dayOptions.map((d) => (
                      <NativeSelectOption key={d.value} value={d.value}>
                        {d.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tt-period">Period</Label>
                  <NativeSelect
                    id="tt-period"
                    className="w-full"
                    value={draft.value.periodId}
                    onChange={(e) => (draft.value = { ...draft.value!, periodId: e.target.value })}
                  >
                    {t.periods.map((p) => (
                      <NativeSelectOption key={p.id} value={p.id}>
                        {p.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="tt-room">Room</Label>
                  <NativeSelect
                    id="tt-room"
                    className="w-full"
                    value={draft.value.roomId}
                    onChange={(e) => (draft.value = { ...draft.value!, roomId: e.target.value })}
                  >
                    <NativeSelectOption value="">No room</NativeSelectOption>
                    {t.rooms.map((r) => (
                      <NativeSelectOption key={r.id} value={r.id}>
                        {r.name}
                        {r.location ? " (location saved)" : ""}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tt-from">From (optional)</Label>
                  <Input
                    id="tt-from"
                    type="date"
                    min={t.term?.startDate ?? undefined}
                    max={t.term?.endDate ?? undefined}
                    value={draft.value.validFrom}
                    onChange={(e) => (draft.value = { ...draft.value!, validFrom: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tt-to">Until (optional)</Label>
                  <Input
                    id="tt-to"
                    type="date"
                    min={t.term?.startDate ?? undefined}
                    max={t.term?.endDate ?? undefined}
                    value={draft.value.validTo}
                    onChange={(e) => (draft.value = { ...draft.value!, validTo: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Without dates the period runs for the whole term
                {t.term ? "" : " (this course has no term, so it runs until removed)"}.
              </p>
              {formError.value && (
                <p role="alert" className="text-sm text-destructive">
                  {formError.value}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => (draft.value = null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving.value || !draft.value.periodId}>
                  {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {editing.value && (
        <OccurrenceDialog
          occurrence={editing.value.o}
          action={editing.value.action}
          rooms={t.rooms}
          onOpenChangeAction={(open) => {
            if (!open) editing.value = null;
          }}
          onDoneAction={() => void loadUpcoming()}
        />
      )}
    </div>
  );
}
