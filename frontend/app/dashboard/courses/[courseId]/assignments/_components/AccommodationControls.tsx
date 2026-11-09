"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Accessibility, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  accommodationBadges,
  accommodationForm,
  accommodationRequest,
  toSummary,
  type Accommodation,
  type AccommodationSummary,
} from "@/lib/courses/accommodations";
import { AccommodationFields } from "@/components/accommodations/AccommodationFields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SubmissionRow } from "./types";

/** "×1.5 time" and "No lockdown" under a student's name on a quiz roster. */
export function AccommodationBadge({
  accommodation,
}: {
  accommodation?: AccommodationSummary | null;
}) {
  const labels = accommodationBadges(accommodation);
  if (labels.length === 0) return null;
  const from =
    accommodation?.source === "student"
      ? "School-wide accommodation"
      : "Accommodation on this quiz";
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {labels.map((label) => (
        <Badge
          key={label}
          variant="outline"
          className="gap-1 text-xs font-normal"
          title={from}
        >
          <Accessibility className="size-3" aria-hidden="true" />
          <span className="sr-only">Accommodation: </span>
          {label}
        </Badge>
      ))}
    </div>
  );
}

/**
 * The roster's per-student accommodation action on a quiz: set (or change)
 * this quiz's accommodation, which replaces the student's school-wide
 * default here, or remove it so the default applies again.
 */
export function AccommodationActions({
  activityId,
  row,
  onChangedAction,
}: {
  activityId: string;
  row: SubmissionRow;
  onChangedAction: (row: SubmissionRow) => void;
}) {
  useSignals();
  const open = useSignal(false);
  const form = useSignal(accommodationForm(null));
  const working = useSignal(false);
  const current = row.accommodation ?? null;
  const own = current?.source === "activity";
  const fallback = row.defaultAccommodation ?? null;
  const path = `/activities/${activityId}/accommodations/${row.studentId}`;

  async function openDialog() {
    form.value = accommodationForm(current);
    open.value = true;
    if (!own) return;
    // The roster has no reasons; read this quiz's to fill it in.
    try {
      const list = await api<Accommodation[]>(
        `/activities/${activityId}/accommodations`,
      );
      const mine = list.find((a) => a.studentId === row.studentId);
      if (mine) form.value = accommodationForm(mine);
    } catch {
      // The rest of the form is already filled in.
    }
  }

  async function save() {
    const checked = accommodationRequest(form.value);
    if (!checked.ok) {
      toast.error(checked.error);
      return;
    }
    working.value = true;
    try {
      const saved = await api<Accommodation>(path, {
        method: "PUT",
        body: checked.body,
      });
      onChangedAction({ ...row, accommodation: toSummary(saved) });
      toast.success(`Saved ${row.name}'s accommodation`);
      open.value = false;
    } catch (err) {
      toast.error(userMessage(err, "Failed to save the accommodation"));
    } finally {
      working.value = false;
    }
  }

  async function remove() {
    working.value = true;
    try {
      await api(path, { method: "DELETE" });
      onChangedAction({ ...row, accommodation: fallback });
      toast.success(
        fallback
          ? `Removed; ${row.name}'s school-wide accommodation applies again`
          : `Removed ${row.name}'s accommodation`,
      );
      open.value = false;
    } catch (err) {
      toast.error(userMessage(err, "Failed to remove the accommodation"));
    } finally {
      working.value = false;
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="sm"
              variant="ghost"
              title="Accommodations"
              aria-label={`Accommodations for ${row.name}`}
              disabled={working.value}
            />
          }
        >
          <Accessibility className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => void openDialog()}>
            {own ? "Change accommodation" : "Accommodations"}
          </DropdownMenuItem>
          {own && (
            <DropdownMenuItem onClick={() => void remove()}>
              Remove accommodation
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={open.value}
        onOpenChange={(v) => {
          if (!v) open.value = false;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accommodations for {row.name}</DialogTitle>
            <DialogDescription>
              Applies to {row.name} on this quiz only, and is never shown to
              other students.
              {fallback && !own
                ? ` It replaces their school-wide accommodation (${accommodationBadges(fallback).join(", ")}) here.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <AccommodationFields
            idPrefix={`accommodation-${row.studentId}`}
            value={form.value}
            onChangeAction={(v) => (form.value = v)}
            disabled={working.value}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => (open.value = false)}
              disabled={working.value}
            >
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={working.value}>
              {working.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
