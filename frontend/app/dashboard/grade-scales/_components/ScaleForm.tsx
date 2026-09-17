"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  BandInput,
  GradeScaleDetail,
  GradeScaleType,
} from "./types";

function emptyBand(): BandInput {
  return {
    label: "",
    minPercentage: 0,
    maxPercentage: 0,
    gpaPoints: null,
    isPass: true,
  };
}

function defaultBandsFor(type: GradeScaleType): BandInput[] {
  if (type === "pass_fail") {
    return [
      { label: "Pass", minPercentage: 50, maxPercentage: 100, gpaPoints: null, isPass: true },
      { label: "Fail", minPercentage: 0, maxPercentage: 49.99, gpaPoints: null, isPass: false },
    ];
  }
  if (type === "gpa") {
    return [
      { label: "A", minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0, isPass: true },
      { label: "B", minPercentage: 80, maxPercentage: 89.99, gpaPoints: 3.0, isPass: true },
      { label: "C", minPercentage: 70, maxPercentage: 79.99, gpaPoints: 2.0, isPass: true },
      { label: "D", minPercentage: 60, maxPercentage: 69.99, gpaPoints: 1.0, isPass: true },
      { label: "F", minPercentage: 0, maxPercentage: 59.99, gpaPoints: 0.0, isPass: false },
    ];
  }
  return [
    { label: "A", minPercentage: 90, maxPercentage: 100, gpaPoints: null, isPass: true },
    { label: "B", minPercentage: 80, maxPercentage: 89.99, gpaPoints: null, isPass: true },
    { label: "C", minPercentage: 70, maxPercentage: 79.99, gpaPoints: null, isPass: true },
    { label: "D", minPercentage: 60, maxPercentage: 69.99, gpaPoints: null, isPass: true },
    { label: "F", minPercentage: 0, maxPercentage: 59.99, gpaPoints: null, isPass: false },
  ];
}

export function ScaleForm({
  existing,
  onSaved,
  onCancel,
}: {
  existing: GradeScaleDetail | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  useSignals();

  const name = useSignal(existing?.name ?? "");
  const scaleType = useSignal<GradeScaleType>(existing?.scaleType ?? "letter");
  const isDefault = useSignal(existing?.isDefault ?? false);
  const bands = useSignal<BandInput[]>(
    existing?.bands.map((b) => ({
      label: b.label,
      minPercentage: b.minPercentage,
      maxPercentage: b.maxPercentage,
      gpaPoints: b.gpaPoints,
      isPass: b.isPass,
    })) ?? defaultBandsFor("letter"),
  );
  const saving = useSignal(false);

  useEffect(() => {
    // Resetting bands to a sensible template makes the create flow feel
    // intentional. Don't clobber the user's bands when they're editing
    // an existing scale and the type didn't change.
    if (existing && existing.scaleType === scaleType.value) return;
    bands.value = defaultBandsFor(scaleType.value);
  }, [scaleType.value, existing]);

  const updateBand = (idx: number, patch: Partial<BandInput>) => {
    bands.value = bands.value.map((b, i) => (i === idx ? { ...b, ...patch } : b));
  };

  const addBand = () => {
    bands.value = [...bands.value, emptyBand()];
  };

  const removeBand = (idx: number) => {
    bands.value = bands.value.filter((_, i) => i !== idx);
  };

  const handleSave = async () => {
    if (!name.value.trim()) {
      toast.error("Name is required");
      return;
    }
    if (bands.value.length === 0) {
      toast.error("Add at least one band");
      return;
    }
    for (const b of bands.value) {
      if (!b.label.trim()) {
        toast.error("Every band needs a label");
        return;
      }
      if (b.minPercentage > b.maxPercentage) {
        toast.error(`Band "${b.label}" has min > max`);
        return;
      }
    }

    saving.value = true;
    try {
      const payload = {
        name: name.value.trim(),
        scaleType: scaleType.value,
        isDefault: isDefault.value,
        bands: bands.value.map((b) => ({
          label: b.label.trim(),
          minPercentage: Number(b.minPercentage),
          maxPercentage: Number(b.maxPercentage),
          gpaPoints:
            scaleType.value === "gpa" && b.gpaPoints != null
              ? Number(b.gpaPoints)
              : null,
          isPass: b.isPass,
        })),
      };

      if (existing) {
        await api(`/grade-scales/${existing.id}`, {
          method: "PATCH",
          body: { name: payload.name, isDefault: payload.isDefault },
        });
        await api(`/grade-scales/${existing.id}/bands`, {
          method: "PUT",
          body: { bands: payload.bands },
        });
        toast.success("Scale updated");
      } else {
        await api("/grade-scales", { method: "POST", body: payload });
        toast.success("Scale created");
      }
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to save scale";
      toast.error(msg);
    } finally {
      saving.value = false;
    }
  };

  const showGpa = scaleType.value === "gpa";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Name</Label>
          <Input
            value={name.value}
            onChange={(e) => (name.value = (e.target as HTMLInputElement).value)}
            placeholder="e.g. Standard Letter Grades"
          />
        </div>
        <div className="space-y-1">
          <Label>Type</Label>
          <Select
            value={scaleType.value}
            onValueChange={(v) => (scaleType.value = v as GradeScaleType)}
            disabled={!!existing}
            items={[
              { value: "letter", label: "Letter (A–F)" },
              { value: "gpa", label: "GPA" },
              { value: "pass_fail", label: "Pass / Fail" },
            ]}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="letter">Letter (A–F)</SelectItem>
              <SelectItem value="gpa">GPA</SelectItem>
              <SelectItem value="pass_fail">Pass / Fail</SelectItem>
            </SelectContent>
          </Select>
          {existing && (
            <p className="text-xs text-muted-foreground">
              Type can&apos;t be changed after creation.
            </p>
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isDefault.value}
          onChange={(e) => (isDefault.value = e.target.checked)}
        />
        Set as the school&apos;s default scale
      </label>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Bands</Label>
          <Button type="button" variant="outline" size="sm" onClick={addBand}>
            <Plus className="mr-1 size-3" /> Add band
          </Button>
        </div>
        <div className="rounded-md border divide-y">
          <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
            <div className="col-span-3">Label</div>
            <div className="col-span-2">Min %</div>
            <div className="col-span-2">Max %</div>
            {showGpa && <div className="col-span-2">GPA</div>}
            <div className={showGpa ? "col-span-2" : "col-span-4"}>Pass</div>
            <div className="col-span-1" />
          </div>
          {bands.value.map((b, i) => (
            <div
              key={i}
              className="grid grid-cols-12 gap-2 items-center px-3 py-2"
            >
              <Input
                className="col-span-3 h-8"
                value={b.label}
                onChange={(e) =>
                  updateBand(i, { label: (e.target as HTMLInputElement).value })
                }
                placeholder="A"
              />
              <Input
                type="number"
                step="any"
                min={0}
                max={100}
                className="col-span-2 h-8"
                value={b.minPercentage}
                onChange={(e) =>
                  updateBand(i, {
                    minPercentage: Number((e.target as HTMLInputElement).value),
                  })
                }
              />
              <Input
                type="number"
                step="any"
                min={0}
                max={100}
                className="col-span-2 h-8"
                value={b.maxPercentage}
                onChange={(e) =>
                  updateBand(i, {
                    maxPercentage: Number((e.target as HTMLInputElement).value),
                  })
                }
              />
              {showGpa && (
                <Input
                  type="number"
                  step="any"
                  min={0}
                  max={10}
                  className="col-span-2 h-8"
                  value={b.gpaPoints ?? ""}
                  onChange={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    updateBand(i, { gpaPoints: v === "" ? null : Number(v) });
                  }}
                />
              )}
              <label
                className={`${
                  showGpa ? "col-span-2" : "col-span-4"
                } flex items-center gap-1 text-xs`}
              >
                <input
                  type="checkbox"
                  checked={b.isPass}
                  onChange={(e) => updateBand(i, { isPass: e.target.checked })}
                />
                Pass
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="col-span-1"
                onClick={() => removeBand(i)}
              >
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Bands may not overlap. Gaps are allowed - scores in a gap will display
          as numeric.
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving.value}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving.value}>
          {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
          {existing ? "Save changes" : "Create scale"}
        </Button>
      </div>
    </div>
  );
}
