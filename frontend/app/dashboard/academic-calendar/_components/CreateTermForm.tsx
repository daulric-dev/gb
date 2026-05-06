"use client";

import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass, termLabel, type Term } from "./types";

interface CreateTermFormProps {
  academicYearId: string;
  existingNames: string[];
  onSuccess: () => void;
}

export function CreateTermForm({ academicYearId, existingNames, onSuccess }: CreateTermFormProps) {
  useSignals();
  const availableNames = (["michaelmas", "hilary", "trinity"] as const).filter(
    (n) => !existingNames.includes(n),
  );
  const name = useSignal<Term["name"]>(availableNames[0] ?? "michaelmas");
  const startDate = useSignal("");
  const endDate = useSignal("");
  const examWeight = useSignal(60);
  const courseworkWeight = useSignal(40);
  const isMinistryReporting = useSignal(false);
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    try {
      await api("/terms", {
        method: "POST",
        body: {
          academicYearId,
          name: name.value,
          startDate: startDate.value,
          endDate: endDate.value,
          examWeight: examWeight.value,
          courseworkWeight: courseworkWeight.value,
          isMinistryReporting: isMinistryReporting.value,
        },
      });
      toast.success("Term created");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="termName">Term</Label>
        <select
          id="termName"
          className={selectClass}
          value={name.value}
          onChange={(e) => (name.value = e.target.value as Term["name"])}
          required
        >
          {availableNames.map((n) => (
            <option key={n} value={n}>
              {termLabel[n]}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="startDate">Start Date</Label>
          <Input
            id="startDate"
            type="date"
            value={startDate.value}
            onChange={(e) => (startDate.value = e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endDate">End Date</Label>
          <Input
            id="endDate"
            type="date"
            value={endDate.value}
            onChange={(e) => (endDate.value = e.target.value)}
            required
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="examWeight">Exam Weight (%)</Label>
          <Input
            id="examWeight"
            type="number"
            min={0}
            max={100}
            value={examWeight.value}
            onChange={(e) => (examWeight.value = Number(e.target.value))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cwWeight">Coursework Weight (%)</Label>
          <Input
            id="cwWeight"
            type="number"
            min={0}
            max={100}
            value={courseworkWeight.value}
            onChange={(e) => (courseworkWeight.value = Number(e.target.value))}
            required
          />
        </div>
        <p className="col-span-2 text-xs text-muted-foreground">
          Weights must add up to 100%
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="ministry"
          type="checkbox"
          checked={isMinistryReporting.value}
          onChange={(e) => (isMinistryReporting.value = e.target.checked)}
          className="size-4 rounded border-input"
        />
        <Label htmlFor="ministry">Ministry Reporting Term</Label>
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={loading.value || availableNames.length === 0}
      >
        {loading.value ? "Creating..." : "Create Term"}
      </Button>
    </form>
  );
}
