"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, Loader2, Plus } from "lucide-react";
import {
  QUESTION_KIND_LABEL,
  type QuestionKind,
  type QuizQuestion,
} from "./types";

export interface QuestionPayload {
  prompt: string;
  kind: QuestionKind;
  points: number;
  options: { label: string; isCorrect: boolean }[];
}

const TRUE_FALSE = ["True", "False"];

/**
 * Writing or editing one question, for all three kinds.
 *
 * The three differ only in what the options mean. Multiple choice offers four
 * slots with one marked right; true/false fixes the wording and only asks
 * which one is right; a short answer has no right-answer picker at all,
 * because every line is an accepted wording and marking compares the student's
 * text against all of them.
 */
export function QuestionForm({
  question,
  submitLabel,
  busy,
  onSubmitAction,
  onCancelAction,
}: {
  /** The question being edited, or undefined when writing a new one. */
  question?: QuizQuestion;
  submitLabel: string;
  busy: boolean;
  onSubmitAction: (payload: QuestionPayload) => void;
  onCancelAction?: () => void;
}) {
  useSignals();

  const kind = useSignal<QuestionKind>(question?.kind ?? "multiple_choice");
  const prompt = useSignal(question?.prompt ?? "");
  const points = useSignal(String(question?.points ?? 1));
  const labels = useSignal<string[]>(
    question
      ? question.options.map((o) => o.label)
      : ["", "", "", ""],
  );
  const correct = useSignal(
    Math.max(0, question?.options.findIndex((o) => o.isCorrect) ?? 0),
  );

  /** Switching kind reshapes the options rather than carrying over nonsense. */
  function changeKind(next: QuestionKind) {
    if (next === kind.value) return;

    if (next === "true_false") {
      labels.value = [...TRUE_FALSE];
      correct.value = 0;
    } else if (next === "short_answer") {
      labels.value = labels.value.filter(Boolean).slice(0, 1);
      if (labels.value.length === 0) labels.value = [""];
    } else {
      const kept = labels.value.filter(Boolean).slice(0, 4);
      labels.value = [...kept, "", "", "", ""].slice(0, 4);
      correct.value = 0;
    }

    kind.value = next;
  }

  function setLabel(i: number, value: string) {
    const next = [...labels.value];
    next[i] = value;
    labels.value = next;
  }

  function submit() {
    const filled = labels.value.map((l) => l.trim());
    const kept = filled.filter(Boolean);

    if (!prompt.value.trim()) {
      toast.error("Write the question");
      return;
    }

    if (kind.value === "short_answer") {
      if (kept.length === 0) {
        toast.error("Add at least one accepted answer");
        return;
      }
      onSubmitAction({
        prompt: prompt.value.trim(),
        kind: kind.value,
        points: Number(points.value) || 1,
        // Every accepted wording counts as right; the student's text is
        // matched against all of them.
        options: kept.map((label) => ({ label, isCorrect: true })),
      });
      return;
    }

    if (kept.length < 2) {
      toast.error("Give at least two options");
      return;
    }

    // The marked index counts blank slots too, so resolve it to a label before
    // dropping the blanks - clearing option 2 must not move the answer.
    const correctLabel = filled[correct.value];
    if (!correctLabel) {
      toast.error("Mark which option is correct");
      return;
    }

    onSubmitAction({
      prompt: prompt.value.trim(),
      kind: kind.value,
      points: Number(points.value) || 1,
      options: kept.map((label) => ({
        label,
        isCorrect: label === correctLabel,
      })),
    });
  }

  const isShort = kind.value === "short_answer";
  const isTrueFalse = kind.value === "true_false";

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Type</Label>
        <Select
          value={kind.value}
          onValueChange={(v) => changeKind(v as QuestionKind)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              Object.keys(QUESTION_KIND_LABEL) as QuestionKind[]
            ).map((k) => (
              <SelectItem key={k} value={k}>
                {QUESTION_KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Textarea
        rows={2}
        placeholder="What is 2 + 2?"
        value={prompt.value}
        onChange={(e) => (prompt.value = e.target.value)}
      />

      {labels.value.map((label, i) => (
        <div key={i} className="flex items-center gap-2">
          {!isShort && (
            <button
              type="button"
              onClick={() => (correct.value = i)}
              aria-label={`Mark option ${i + 1} correct`}
              aria-pressed={correct.value === i}
              className={`flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
                correct.value === i
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "text-muted-foreground"
              }`}
            >
              <Check className="size-4" />
            </button>
          )}
          <Input
            placeholder={
              isShort
                ? `Accepted answer ${i + 1}`
                : `Option ${i + 1}${i > 1 ? " (optional)" : ""}`
            }
            value={label}
            disabled={isTrueFalse}
            onChange={(e) => setLabel(i, e.target.value)}
          />
        </div>
      ))}

      {isShort && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => (labels.value = [...labels.value, ""])}
        >
          <Plus className="mr-2 size-4" />
          Another accepted answer
        </Button>
      )}

      <div className="flex items-end gap-2">
        <div className="w-24 space-y-1">
          <Label className="text-xs">Points</Label>
          <Input
            type="number"
            min={1}
            value={points.value}
            onChange={(e) => (points.value = e.target.value)}
          />
        </div>
        <div className="ml-auto flex gap-2">
          {onCancelAction && (
            <Button variant="outline" onClick={onCancelAction} disabled={busy}>
              Cancel
            </Button>
          )}
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {isShort
          ? "Marking ignores capitals and surrounding spaces. Add every wording you would accept."
          : "Tick the circle beside the correct answer."}{" "}
        Questions can only change while this is a draft.
      </p>
    </div>
  );
}
