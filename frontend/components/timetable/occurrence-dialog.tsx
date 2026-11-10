"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  formatDay,
  minutesToTime,
  timeToMinutes,
  type Room,
  type TimetableOccurrence,
} from "@/lib/timetable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type OccurrenceAction = "cancel" | "move";

/**
 * Cancel or move one period (PUT /courses/:courseId/timetable/occurrences/
 * :entryId/:date). The API refuses it once attendance for the period has
 * opened, and for anyone but the course's teachers and admins.
 */
export function OccurrenceDialog({
  occurrence,
  action,
  rooms,
  onOpenChangeAction,
  onDoneAction,
}: {
  occurrence: TimetableOccurrence | null;
  action: OccurrenceAction;
  rooms?: Room[];
  onOpenChangeAction: (open: boolean) => void;
  onDoneAction: () => void;
}) {
  useSignals();
  const date = useSignal("");
  const start = useSignal("");
  const end = useSignal("");
  const roomId = useSignal("");
  const note = useSignal("");
  const saving = useSignal(false);
  const error = useSignal<string | null>(null);

  useEffect(() => {
    if (!occurrence) return;
    date.value = occurrence.date;
    start.value = minutesToTime(occurrence.startMinute);
    end.value = minutesToTime(occurrence.endMinute);
    roomId.value = occurrence.roomId ?? "";
    note.value = occurrence.note ?? "";
    error.value = null;
  }, [occurrence, date, start, end, roomId, note, error]);

  if (!occurrence) return null;
  const o = occurrence;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    error.value = null;
    let body: Record<string, unknown> = { kind: action, note: note.value.trim() || undefined };
    if (action === "move") {
      const s = timeToMinutes(start.value);
      const en = timeToMinutes(end.value);
      if (s === null || en === null) {
        error.value = "Enter times as HH:MM.";
        return;
      }
      if (en <= s) {
        error.value = "The period must end after it starts.";
        return;
      }
      body = { ...body, date: date.value, startMinute: s, endMinute: en, roomId: roomId.value || null };
    }
    saving.value = true;
    try {
      await api(`/courses/${o.courseId}/timetable/occurrences/${o.entryId}/${o.occursOn}`, {
        method: "PUT",
        body,
      });
      toast.success(action === "cancel" ? "Period cancelled" : "Period moved");
      onDoneAction();
      onOpenChangeAction(false);
    } catch (err) {
      error.value = userMessage(err, "Could not change this period");
    } finally {
      saving.value = false;
    }
  }

  const title = action === "cancel" ? "Cancel this period" : "Move this period";
  return (
    <Dialog open onOpenChange={onOpenChangeAction}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {o.courseName} · {o.periodName} · {formatDay(o.occursOn)}{" "}
              {minutesToTime(o.startMinute)}. No attendance session opens for a
              cancelled period; a moved one opens at its new time.
            </DialogDescription>
          </DialogHeader>

          {action === "move" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor="occ-date">Date</Label>
                <Input
                  id="occ-date"
                  type="date"
                  required
                  value={date.value}
                  onChange={(e) => (date.value = e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="occ-start">Starts</Label>
                <Input
                  id="occ-start"
                  type="time"
                  required
                  value={start.value}
                  onChange={(e) => (start.value = e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="occ-end">Ends</Label>
                <Input
                  id="occ-end"
                  type="time"
                  required
                  value={end.value}
                  onChange={(e) => (end.value = e.target.value)}
                />
              </div>
              {rooms && (
                <div className="space-y-1.5">
                  <Label htmlFor="occ-room">Room</Label>
                  <NativeSelect
                    id="occ-room"
                    className="w-full"
                    value={roomId.value}
                    onChange={(e) => (roomId.value = e.target.value)}
                  >
                    <NativeSelectOption value="">Same room</NativeSelectOption>
                    {rooms.map((r) => (
                      <NativeSelectOption key={r.id} value={r.id}>
                        {r.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="occ-note">Note for students (optional)</Label>
            <Input
              id="occ-note"
              maxLength={200}
              value={note.value}
              onChange={(e) => (note.value = e.target.value)}
              placeholder={action === "cancel" ? "e.g. School trip" : "e.g. In the hall today"}
            />
          </div>

          {error.value && (
            <p role="alert" className="text-sm text-destructive">
              {error.value}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChangeAction(false)}>
              Close
            </Button>
            <Button type="submit" disabled={saving.value} variant={action === "cancel" ? "destructive" : "default"}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              {action === "cancel" ? "Cancel period" : "Move period"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** DELETE the override: the period goes back to its usual slot. */
export async function restoreOccurrence(o: TimetableOccurrence): Promise<void> {
  await api(`/courses/${o.courseId}/timetable/occurrences/${o.entryId}/${o.occursOn}`, {
    method: "DELETE",
  });
}
