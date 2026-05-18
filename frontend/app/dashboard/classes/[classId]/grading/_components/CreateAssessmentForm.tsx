"use client";

import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass } from "./types";

export function CreateAssessmentForm({
  termId,
  subjectId,
  onSuccess,
}: {
  termId: string;
  subjectId: string;
  onSuccess: () => void;
}) {
  useSignals();
  const title = useSignal("");
  const assessmentType = useSignal<"exam" | "coursework">("coursework");
  const maxScore = useSignal(100);
  const weight = useSignal(1);
  const assessmentDate = useSignal("");
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    const body: Record<string, unknown> = {
      termId,
      subjectId,
      title: title.value,
      assessmentType: assessmentType.value,
      maxScore: maxScore.value,
      weight: weight.value,
    };
    if (assessmentDate.value) body.assessmentDate = assessmentDate.value;

    try {
      await api("/assessments", { method: "POST", body });
      toast.success("Assessment created");
      onSuccess();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Failed to create";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          placeholder="Mid-term Exam"
          value={title.value}
          onChange={(e) => (title.value = e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="type">Type</Label>
        <select
          id="type"
          className={selectClass}
          value={assessmentType.value}
          onChange={(e) =>
            (assessmentType.value = e.target.value as "exam" | "coursework")
          }
        >
          <option value="exam">Exam</option>
          <option value="coursework">Coursework</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="maxScore">Max Score</Label>
          <Input
            id="maxScore"
            type="number"
            min={1}
            max={1000}
            value={maxScore.value}
            onChange={(e) => (maxScore.value = Number(e.target.value))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="weight">Weight</Label>
          <Input
            id="weight"
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
        <Label htmlFor="date">Date (optional)</Label>
        <Input
          id="date"
          type="date"
          value={assessmentDate.value}
          onChange={(e) => (assessmentDate.value = e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Creating..." : "Create Assessment"}
      </Button>
    </form>
  );
}
