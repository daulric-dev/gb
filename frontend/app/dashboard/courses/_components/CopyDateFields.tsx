"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CopyDates } from "@/lib/courses/types";

export type DateMode = "keep" | "shift" | "starts" | "clear";

export interface DateChoice {
  mode: DateMode;
  days: string;
  sourceStart: string;
  targetStart: string;
}

export const EMPTY_DATE_CHOICE: DateChoice = {
  mode: "keep",
  days: "",
  sourceStart: "",
  targetStart: "",
};

const MODES: { value: DateMode; label: string }[] = [
  { value: "keep", label: "Keep due dates as they are" },
  { value: "shift", label: "Move every due date by a number of days" },
  { value: "starts", label: "Move from the old start date to a new one" },
  { value: "clear", label: "Remove due dates" },
];

/**
 * The request fields for a choice, or an error message when it is
 * incomplete. Copied activities are drafts either way, so dates can still be
 * fixed one by one before anything is published.
 */
export function copyDatesOf(choice: DateChoice): CopyDates | string {
  switch (choice.mode) {
    case "shift": {
      const days = Number(choice.days);
      if (!choice.days.trim() || !Number.isInteger(days)) {
        return "Enter a whole number of days";
      }
      return { shiftDays: days };
    }
    case "starts":
      if (!choice.sourceStart || !choice.targetStart) {
        return "Pick both start dates";
      }
      return {
        sourceStartDate: choice.sourceStart,
        targetStartDate: choice.targetStart,
      };
    case "clear":
      return { clearDueDates: true };
    default:
      return {};
  }
}

/** Picks how due dates carry over into a copied course. */
export function CopyDateFields({
  value,
  onChangeAction,
  disabled,
}: {
  value: DateChoice;
  onChangeAction: (next: DateChoice) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<DateChoice>) =>
    onChangeAction({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Due dates</Label>
        <Select
          value={value.mode}
          onValueChange={(v) => set({ mode: v as DateMode })}
          items={MODES}
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value.mode === "shift" && (
        <div className="space-y-2">
          <Label htmlFor="copyShiftDays">Days (negative moves earlier)</Label>
          <Input
            id="copyShiftDays"
            type="number"
            step={1}
            placeholder="364"
            className="w-40"
            value={value.days}
            onChange={(e) => set({ days: e.target.value })}
            disabled={disabled}
          />
        </div>
      )}

      {value.mode === "starts" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="copySourceStart">Old course started</Label>
            <Input
              id="copySourceStart"
              type="date"
              value={value.sourceStart}
              onChange={(e) => set({ sourceStart: e.target.value })}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="copyTargetStart">New course starts</Label>
            <Input
              id="copyTargetStart"
              type="date"
              value={value.targetStart}
              onChange={(e) => set({ targetStart: e.target.value })}
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  );
}
