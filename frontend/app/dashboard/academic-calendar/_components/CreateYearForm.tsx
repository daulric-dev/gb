"use client";

import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CreateYearFormProps {
  onSuccess: () => void;
}

export function CreateYearForm({ onSuccess }: CreateYearFormProps) {
  useSignals();
  const name = useSignal("");
  const startDate = useSignal("");
  const endDate = useSignal("");
  const gradingModel = useSignal<"term_based" | "year_based">("term_based");
  const examWeight = useSignal(60);
  const courseworkWeight = useSignal(40);
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    const body: Record<string, unknown> = {
      name: name.value,
      startDate: startDate.value,
      endDate: endDate.value,
      gradingModel: gradingModel.value,
    };

    if (gradingModel.value === "year_based") {
      body.yearExamWeight = examWeight.value;
      body.yearCourseworkWeight = courseworkWeight.value;
    }

    try {
      await api("/academic-years", { method: "POST", body });
      toast.success("Academic year created");
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
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          placeholder="2025/2026"
          value={name.value}
          onChange={(e) => (name.value = e.target.value)}
          required
        />
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
      <div className="space-y-2">
        <Label htmlFor="gradingModel">Grading Model</Label>
        <select
          id="gradingModel"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={gradingModel.value}
          onChange={(e) =>
            (gradingModel.value = e.target.value as "term_based" | "year_based")
          }
        >
          <option value="term_based">Term Based</option>
          <option value="year_based">Year Based</option>
        </select>
      </div>
      {gradingModel.value === "year_based" && (
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
      )}
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Creating..." : "Create Academic Year"}
      </Button>
    </form>
  );
}
