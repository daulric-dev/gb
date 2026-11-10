"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_EXTRA_MINUTES,
  TIME_MULTIPLIERS,
  multiplierLabel,
  type AccommodationForm,
} from "@/lib/courses/accommodations";

/**
 * The inputs for a quiz accommodation: extra time (a multiplier or extra
 * minutes), Lockdown exemption, and a reason. Used in the teacher roster for
 * one quiz and on the staff student page for the school-wide default.
 */
export function AccommodationFields({
  idPrefix,
  value,
  onChangeAction,
  disabled = false,
}: {
  idPrefix: string;
  value: AccommodationForm;
  onChangeAction: (value: AccommodationForm) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<AccommodationForm>) =>
    onChangeAction({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-time`} className="text-xs">
          Time on timed quizzes
        </Label>
        <NativeSelect
          id={`${idPrefix}-time`}
          className="w-full"
          value={value.time}
          disabled={disabled}
          onChange={(e) => set({ time: e.target.value })}
        >
          <NativeSelectOption value="none">Standard time</NativeSelectOption>
          {TIME_MULTIPLIERS.map((m) => (
            <NativeSelectOption key={m} value={String(m)}>
              {multiplierLabel(m)} the time limit
            </NativeSelectOption>
          ))}
          <NativeSelectOption value="extra">Extra minutes</NativeSelectOption>
        </NativeSelect>
      </div>
      {value.time === "extra" && (
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-minutes`} className="text-xs">
            Extra minutes (1 to {MAX_EXTRA_MINUTES})
          </Label>
          <Input
            id={`${idPrefix}-minutes`}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_EXTRA_MINUTES}
            step={1}
            value={value.extraMinutes}
            disabled={disabled}
            onChange={(e) => set({ extraMinutes: e.target.value })}
          />
        </div>
      )}
      <div className="flex items-start gap-2">
        <Checkbox
          id={`${idPrefix}-lockdown`}
          checked={value.lockdownExempt}
          disabled={disabled}
          onCheckedChange={(checked) => set({ lockdownExempt: !!checked })}
        />
        <div className="space-y-0.5">
          <Label htmlFor={`${idPrefix}-lockdown`} className="text-sm">
            Exempt from Lockdown
          </Label>
          <p className="text-xs text-muted-foreground">
            No fullscreen or app pinning, and never reported as away. For
            students whose assistive tools Lockdown blocks.
          </p>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-reason`} className="text-xs">
          Reason (optional, staff only)
        </Label>
        <Textarea
          id={`${idPrefix}-reason`}
          rows={2}
          maxLength={500}
          placeholder="Uses a screen reader"
          value={value.reason}
          disabled={disabled}
          onChange={(e) => set({ reason: e.target.value })}
        />
      </div>
    </div>
  );
}
