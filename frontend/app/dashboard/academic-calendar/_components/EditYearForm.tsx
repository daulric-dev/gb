"use client";

import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type AcademicYear, type GradingModel, GRADING_MODEL_LABELS } from "./types";

interface EditYearFormProps {
  year: AcademicYear;
  onSuccess: () => void;
}

export function EditYearForm({ year, onSuccess }: EditYearFormProps) {
  useSignals();
  const name = useSignal(year.name);
  const startDate = useSignal(year.start_date);
  const endDate = useSignal(year.end_date);
  const gradingModel = useSignal<GradingModel>(year.grading_model);
  const examWeight = useSignal(year.year_exam_weight ?? 60);
  const courseworkWeight = useSignal(year.year_coursework_weight ?? 40);
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    const body: Record<string, unknown> = {
      name: name.value,
      startDate: startDate.value,
      endDate: endDate.value,
      gradingModel: gradingModel.value,
      yearExamWeight: examWeight.value,
      yearCourseworkWeight: courseworkWeight.value,
    };

    try {
      await api(`/academic-years/${year.id}`, { method: "PATCH", body });
      toast.success("Academic year updated");
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
        <Label htmlFor="editName">Name</Label>
        <Input
          id="editName"
          value={name.value}
          onChange={(e) => (name.value = e.target.value)}
          required
        />
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
      <div className="space-y-2">
        <Label htmlFor="editGradingModel">Grading Model</Label>
        <select
          id="editGradingModel"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={gradingModel.value}
          onChange={(e) =>
            (gradingModel.value = e.target.value as GradingModel)
          }
        >
          {Object.entries(GRADING_MODEL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
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
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
