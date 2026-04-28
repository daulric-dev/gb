"use client";

import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Assessment } from "./types";

export function EditAssessmentForm({
  assessment,
  onSuccess,
}: {
  assessment: Assessment;
  onSuccess: () => void;
}) {
  useSignals();
  const title = useSignal(assessment.title);
  const maxScore = useSignal(assessment.max_score);
  const weight = useSignal(assessment.weight);
  const assessmentDate = useSignal(assessment.assessment_date ?? "");
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    try {
      await api(`/assessments/${assessment.id}`, {
        method: "PATCH",
        body: {
          title: title.value,
          maxScore: maxScore.value,
          weight: weight.value,
          assessmentDate: assessmentDate.value || undefined,
        },
      });
      toast.success("Assessment updated");
      onSuccess();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Failed to update";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="editTitle">Title</Label>
        <Input
          id="editTitle"
          value={title.value}
          onChange={(e) => (title.value = e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label>Type</Label>
        <p className="text-sm font-medium capitalize">
          {assessment.assessment_type}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editMaxScore">Max Score</Label>
          <Input
            id="editMaxScore"
            type="number"
            min={1}
            max={1000}
            value={maxScore.value}
            onChange={(e) => (maxScore.value = Number(e.target.value))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editWeight">Weight</Label>
          <Input
            id="editWeight"
            type="number"
            min={0}
            step="any"
            value={weight.value}
            onChange={(e) => (weight.value = Number(e.target.value))}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="editDate">Date</Label>
        <Input
          id="editDate"
          type="date"
          value={assessmentDate.value}
          onChange={(e) => (assessmentDate.value = e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
