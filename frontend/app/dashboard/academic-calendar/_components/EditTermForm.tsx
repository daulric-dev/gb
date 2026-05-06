"use client";

import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { termLabel, type Term } from "./types";

interface EditTermFormProps {
  term: Term;
  onSuccess: () => void;
}

export function EditTermForm({ term, onSuccess }: EditTermFormProps) {
  useSignals();
  const startDate = useSignal(term.start_date);
  const endDate = useSignal(term.end_date);
  const examWeight = useSignal(term.exam_weight);
  const courseworkWeight = useSignal(term.coursework_weight);
  const isMinistryReporting = useSignal(term.is_ministry_reporting);
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    try {
      await api(`/terms/${term.id}`, {
        method: "PATCH",
        body: {
          startDate: startDate.value,
          endDate: endDate.value,
          examWeight: examWeight.value,
          courseworkWeight: courseworkWeight.value,
          isMinistryReporting: isMinistryReporting.value,
        },
      });
      toast.success("Term updated");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to update";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Term</Label>
        <p className="text-sm font-medium">{termLabel[term.name]}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editStartDate">Start Date</Label>
          <Input
            id="editStartDate"
            type="date"
            value={startDate.value}
            onChange={(e) => (startDate.value = e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editEndDate">End Date</Label>
          <Input
            id="editEndDate"
            type="date"
            value={endDate.value}
            onChange={(e) => (endDate.value = e.target.value)}
            required
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editExamWeight">Exam Weight (%)</Label>
          <Input
            id="editExamWeight"
            type="number"
            min={0}
            max={100}
            value={examWeight.value}
            onChange={(e) => (examWeight.value = Number(e.target.value))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editCwWeight">Coursework Weight (%)</Label>
          <Input
            id="editCwWeight"
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
          id="editMinistry"
          type="checkbox"
          checked={isMinistryReporting.value}
          onChange={(e) => (isMinistryReporting.value = e.target.checked)}
          className="size-4 rounded border-input"
        />
        <Label htmlFor="editMinistry">Ministry Reporting Term</Label>
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
