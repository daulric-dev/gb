"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  PenLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadFromUrl } from "@/lib/download";
import { cn } from "@/lib/utils";
import type { ActivityKind, CalendarItem } from "@/lib/courses/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Chips shown in a day cell before "+N more". */
const PER_CELL = 3;

/** One colour per course, stable across renders and pages. */
const COURSE_COLOURS = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-orange-500",
  "bg-fuchsia-500",
];

export function courseColour(courseId: string) {
  let h = 0;
  for (let i = 0; i < courseId.length; i++) {
    h = (h * 31 + courseId.charCodeAt(i)) >>> 0;
  }
  return COURSE_COLOURS[h % COURSE_COLOURS.length];
}

function KindIcon({ kind, className }: { kind: ActivityKind; className?: string }) {
  if (kind === "quiz") return <ClipboardList className={className} />;
  if (kind === "offline") return <PenLine className={className} />;
  return <FileText className={className} />;
}

/** Local-midnight key, so an item lands on the viewer's own day. */
function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** The six-week grid for a month, Sunday first. */
function gridDays(month: Date): Date[] {
  const first = startOfMonth(month);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A month grid of due dates with an agenda for the selected day.
 *
 * Shared by the staff dashboard and the student portal: the page supplies
 * how to load a range, where an item links to, and an optional badge.
 */
export function DueCalendar<T extends CalendarItem>({
  load,
  hrefFor,
  badgeFor,
  icsPath,
  emptyText = "Nothing due this day.",
}: {
  load: (from: string, to: string) => Promise<T[]>;
  hrefFor: (item: T) => string;
  badgeFor?: (item: T) => ReactNode;
  /** API path of the .ics export; the visible range is appended. */
  icsPath?: string;
  emptyText?: string;
}) {
  useSignals();

  const month = useSignal(startOfMonth(new Date()));
  const selected = useSignal(new Date());
  const items = useSignal<T[]>([]);
  const loading = useSignal(true);

  const days = gridDays(month.value);
  const from = days[0].toISOString();
  const to = addDays(days[days.length - 1], 1).toISOString();

  useEffect(() => {
    let cancelled = false;
    loading.value = true;
    load(from, to)
      .then((data) => {
        if (!cancelled) items.value = data;
      })
      .catch(() => {
        if (!cancelled) {
          items.value = [];
          toast.error("Failed to load the calendar");
        }
      })
      .finally(() => {
        if (!cancelled) loading.value = false;
      });
    return () => {
      cancelled = true;
    };
    // `load` is a fresh closure each render; the range is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const byDay = new Map<string, T[]>();
  for (const item of items.value) {
    const key = dayKey(new Date(item.dueAt));
    const list = byDay.get(key) ?? [];
    list.push(item);
    byDay.set(key, list);
  }

  const todayKey = dayKey(new Date());
  const selectedKey = dayKey(selected.value);
  const selectedItems = byDay.get(selectedKey) ?? [];
  const currentMonth = month.value.getMonth();

  const go = (delta: number) => {
    const m = month.value;
    month.value = new Date(m.getFullYear(), m.getMonth() + delta, 1);
    selected.value = month.value;
  };
  const goToday = () => {
    month.value = startOfMonth(new Date());
    selected.value = new Date();
  };

  async function exportIcs() {
    if (!icsPath) return;
    try {
      const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      await downloadFromUrl(`${icsPath}?${qs}`, "due-dates.ics");
    } catch {
      toast.error("Failed to export the calendar");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">
          {month.value.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </h2>
        <Button variant="outline" size="sm" onClick={goToday}>
          Today
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous month"
          onClick={() => go(-1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next month"
          onClick={() => go(1)}
        >
          <ChevronRight />
        </Button>
        {icsPath && (
          <Button variant="outline" size="sm" onClick={exportIcs}>
            <Download data-icon="inline-start" />
            Export .ics
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-medium text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const key = dayKey(day);
            const dayItems = byDay.get(key) ?? [];
            const inMonth = day.getMonth() === currentMonth;
            const isToday = key === todayKey;
            const isSelected = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => (selected.value = day)}
                aria-pressed={isSelected}
                aria-label={`${day.toDateString()}, ${dayItems.length} due`}
                className={cn(
                  "flex min-h-14 flex-col gap-1 border-b border-r p-1 text-left align-top transition-colors hover:bg-muted/50 sm:min-h-24 sm:p-1.5",
                  i % 7 === 6 && "border-r-0",
                  i >= 35 && "border-b-0",
                  !inMonth && "bg-muted/20 text-muted-foreground",
                  isSelected && "bg-primary/5 ring-1 ring-inset ring-primary",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs",
                    isToday && "bg-primary font-semibold text-primary-foreground",
                  )}
                >
                  {day.getDate()}
                </span>
                {loading.value ? (
                  inMonth && i % 5 === 0 && <Skeleton className="h-3 w-full" />
                ) : (
                  <>
                    {/* Phones get dots; wider screens get titled chips. */}
                    <div className="flex flex-wrap gap-0.5 sm:hidden">
                      {dayItems.slice(0, 4).map((item) => (
                        <span
                          key={item.activityId}
                          className={cn("size-1.5 rounded-full", courseColour(item.courseId))}
                        />
                      ))}
                    </div>
                    <div className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                      {dayItems.slice(0, PER_CELL).map((item) => (
                        <span
                          key={item.activityId}
                          className={cn(
                            "flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-tight",
                            item.status === "draft"
                              ? "border border-dashed text-muted-foreground"
                              : "bg-muted",
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              courseColour(item.courseId),
                            )}
                          />
                          <span className="truncate">{item.title}</span>
                        </span>
                      ))}
                      {dayItems.length > PER_CELL && (
                        <span className="px-1 text-[11px] text-muted-foreground">
                          +{dayItems.length - PER_CELL} more
                        </span>
                      )}
                    </div>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {selected.value.toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {selectedItems.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {selectedItems.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            selectedItems.map((item) => (
              <div
                key={item.activityId}
                className="relative flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="relative flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <KindIcon kind={item.kind} className="size-4" />
                  <span
                    className={cn(
                      "absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-background",
                      courseColour(item.courseId),
                    )}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={hrefFor(item)}
                    className="block truncate font-medium after:absolute after:inset-0"
                  >
                    {item.title}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.courseName} · Due {timeLabel(item.dueAt)}
                  </p>
                </div>
                {badgeFor?.(item)}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
