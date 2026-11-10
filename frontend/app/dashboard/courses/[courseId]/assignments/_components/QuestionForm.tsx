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
import { ArrowDown, ArrowUp, Check, Loader2, Plus, Trash2 } from "lucide-react";
import {
  QUESTION_KIND_LABEL,
  type QuestionKind,
  type QuizQuestion,
} from "./types";

export interface QuestionPayload {
  prompt: string;
  kind: QuestionKind;
  points: number;
  options?: { label: string; isCorrect?: boolean; matchLabel?: string | null }[];
  numericAnswer?: number | null;
  numericTolerance?: number | null;
  scoring?: "all_or_nothing" | "partial";
  rubricId?: string | null;
  fileTypes?: string[];
  fileMaxMb?: number | null;
}

const TRUE_FALSE = ["True", "False"];

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

  // Choice & short answer options
  const labels = useSignal<string[]>(
    question
      ? question.options.map((o) => o.label)
      : ["", "", "", ""],
  );
  const correct = useSignal(
    Math.max(0, question?.options.findIndex((o) => o.isCorrect) ?? 0),
  );
  const multiCorrect = useSignal<boolean[]>(
    question && question.kind === "multiple_select"
      ? question.options.map((o) => !!o.isCorrect)
      : [true, false, false, false],
  );

  // Numeric
  const numericAnswer = useSignal(
    question?.numericAnswer !== undefined && question.numericAnswer !== null
      ? String(question.numericAnswer)
      : "",
  );
  const numericTolerance = useSignal(
    question?.numericTolerance !== undefined && question.numericTolerance !== null
      ? String(question.numericTolerance)
      : "0",
  );

  // Matching pairs
  const matchingPairs = useSignal<{ left: string; right: string }[]>(
    question && question.kind === "matching" && question.options.length
      ? question.options.map((o) => ({ left: o.label, right: o.matchLabel ?? "" }))
      : [
          { left: "", right: "" },
          { left: "", right: "" },
        ],
  );

  // Ordering items
  const orderingItems = useSignal<string[]>(
    question && question.kind === "ordering" && question.options.length
      ? question.options.map((o) => o.label)
      : ["", "", ""],
  );

  // Scoring mode
  const scoring = useSignal<"all_or_nothing" | "partial">(
    question?.scoring ?? "all_or_nothing",
  );

  // File upload settings
  const fileTypes = useSignal(question?.fileTypes?.join(", ") ?? "");
  const fileMaxMb = useSignal(
    question?.fileMaxMb !== undefined && question.fileMaxMb !== null
      ? String(question.fileMaxMb)
      : "",
  );

  /** Switching kind reshapes options appropriately */
  function changeKind(next: QuestionKind) {
    if (next === kind.value) return;

    if (next === "true_false") {
      labels.value = [...TRUE_FALSE];
      correct.value = 0;
    } else if (next === "short_answer") {
      labels.value = labels.value.filter(Boolean).slice(0, 1);
      if (labels.value.length === 0) labels.value = [""];
    } else if (next === "multiple_select") {
      const kept = labels.value.filter(Boolean).slice(0, 4);
      labels.value = [...kept, "", "", "", ""].slice(0, 4);
      multiCorrect.value = [true, false, false, false];
    } else if (next === "matching") {
      if (matchingPairs.value.length < 2) {
        matchingPairs.value = [
          { left: "", right: "" },
          { left: "", right: "" },
        ];
      }
    } else if (next === "ordering") {
      if (orderingItems.value.length < 2) {
        orderingItems.value = ["", "", ""];
      }
    } else if (next === "multiple_choice") {
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

  function toggleMultiCorrect(i: number) {
    const next = [...multiCorrect.value];
    next[i] = !next[i];
    multiCorrect.value = next;
  }

  function submit() {
    const promptText = prompt.value.trim();
    if (!promptText) {
      toast.error("Write the question prompt");
      return;
    }
    const pts = Number(points.value);
    if (!Number.isFinite(pts) || pts <= 0) {
      toast.error("Points must be greater than 0");
      return;
    }

    const k = kind.value;

    if (k === "short_answer") {
      const kept = labels.value.map((l) => l.trim()).filter(Boolean);
      if (kept.length === 0) {
        toast.error("Add at least one accepted answer");
        return;
      }
      onSubmitAction({
        prompt: promptText,
        kind: k,
        points: pts,
        options: kept.map((label) => ({ label, isCorrect: true })),
      });
      return;
    }

    if (k === "multiple_choice" || k === "true_false") {
      const filled = labels.value.map((l) => l.trim());
      const kept = filled.filter(Boolean);
      if (kept.length < 2) {
        toast.error("Provide at least two options");
        return;
      }
      const correctLabel = filled[correct.value];
      if (!correctLabel) {
        toast.error("Mark which option is correct");
        return;
      }
      onSubmitAction({
        prompt: promptText,
        kind: k,
        points: pts,
        options: kept.map((label) => ({
          label,
          isCorrect: label === correctLabel,
        })),
      });
      return;
    }

    if (k === "multiple_select") {
      const filled = labels.value.map((l) => l.trim());
      const keptIndices = filled
        .map((label, idx) => ({ label, idx }))
        .filter((item) => item.label.length > 0);
      if (keptIndices.length < 2) {
        toast.error("Provide at least two options");
        return;
      }
      const hasCorrect = keptIndices.some((item) => multiCorrect.value[item.idx]);
      if (!hasCorrect) {
        toast.error("Mark at least one correct option");
        return;
      }
      onSubmitAction({
        prompt: promptText,
        kind: k,
        points: pts,
        scoring: scoring.value,
        options: keptIndices.map((item) => ({
          label: item.label,
          isCorrect: !!multiCorrect.value[item.idx],
        })),
      });
      return;
    }

    if (k === "numeric") {
      const num = Number(numericAnswer.value);
      if (!Number.isFinite(num)) {
        toast.error("Enter a valid numeric answer");
        return;
      }
      const tol = Number(numericTolerance.value || "0");
      if (!Number.isFinite(tol) || tol < 0) {
        toast.error("Tolerance must be 0 or a positive number");
        return;
      }
      onSubmitAction({
        prompt: promptText,
        kind: k,
        points: pts,
        numericAnswer: num,
        numericTolerance: tol,
      });
      return;
    }

    if (k === "essay") {
      onSubmitAction({
        prompt: promptText,
        kind: k,
        points: pts,
      });
      return;
    }

    if (k === "matching") {
      const validPairs = matchingPairs.value
        .map((p) => ({ left: p.left.trim(), right: p.right.trim() }))
        .filter((p) => p.left && p.right);
      if (validPairs.length < 2) {
        toast.error("Provide at least two matching pairs");
        return;
      }
      onSubmitAction({
        prompt: promptText,
        kind: k,
        points: pts,
        scoring: scoring.value,
        options: validPairs.map((p) => ({
          label: p.left,
          matchLabel: p.right,
          isCorrect: true,
        })),
      });
      return;
    }

    if (k === "ordering") {
      const items = orderingItems.value.map((s) => s.trim()).filter(Boolean);
      if (items.length < 2) {
        toast.error("Provide at least two items to order");
        return;
      }
      onSubmitAction({
        prompt: promptText,
        kind: k,
        points: pts,
        scoring: scoring.value,
        options: items.map((label) => ({ label, isCorrect: true })),
      });
      return;
    }

    if (k === "file_upload") {
      const parsedTypes = fileTypes.value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const maxMb = fileMaxMb.value.trim() ? Number(fileMaxMb.value) : null;
      if (maxMb !== null && (!Number.isInteger(maxMb) || maxMb < 1 || maxMb > 1000)) {
        toast.error("File max size must be between 1 and 1000 MB");
        return;
      }
      onSubmitAction({
        prompt: promptText,
        kind: k,
        points: pts,
        fileTypes: parsedTypes.length ? parsedTypes : undefined,
        fileMaxMb: maxMb,
      });
      return;
    }
  }

  const isTrueFalse = kind.value === "true_false";

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Question type</Label>
        <Select
          value={kind.value}
          onValueChange={(v) => changeKind(v as QuestionKind)}
          items={(Object.keys(QUESTION_KIND_LABEL) as QuestionKind[]).map((k) => ({
            value: k,
            label: QUESTION_KIND_LABEL[k],
          }))}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(QUESTION_KIND_LABEL) as QuestionKind[]).map((k) => (
              <SelectItem key={k} value={k}>
                {QUESTION_KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Prompt</Label>
        <Textarea
          rows={3}
          placeholder="Enter question instructions or prompt..."
          value={prompt.value}
          onChange={(e) => (prompt.value = e.target.value)}
        />
      </div>

      {/* Choice questions (multiple choice & true/false) */}
      {(kind.value === "multiple_choice" || kind.value === "true_false") && (
        <div className="space-y-2">
          <Label className="text-xs">Options (choose one correct)</Label>
          {labels.value.map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => (correct.value = i)}
                aria-label={`Mark option ${i + 1} correct`}
                aria-pressed={correct.value === i}
                className={`flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  correct.value === i
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Check className="size-4" />
              </button>
              <Input
                placeholder={`Option ${i + 1}${i > 1 ? " (optional)" : ""}`}
                value={label}
                disabled={isTrueFalse}
                onChange={(e) => setLabel(i, e.target.value)}
              />
            </div>
          ))}
          {!isTrueFalse && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                labels.value = [...labels.value, ""];
              }}
            >
              <Plus className="mr-2 size-4" />
              Add option
            </Button>
          )}
        </div>
      )}

      {/* Multiple select */}
      {kind.value === "multiple_select" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Options (tick all that apply)</Label>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Scoring:</Label>
              <Select
                value={scoring.value}
                onValueChange={(v) =>
                  (scoring.value = v as "all_or_nothing" | "partial")
                }
                items={[
                  { value: "all_or_nothing", label: "All or nothing" },
                  { value: "partial", label: "Partial credit" },
                ]}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_or_nothing">All or nothing</SelectItem>
                  <SelectItem value="partial">Partial credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {labels.value.map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleMultiCorrect(i)}
                aria-label={`Toggle option ${i + 1} correct`}
                aria-pressed={!!multiCorrect.value[i]}
                className={`flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors ${
                  multiCorrect.value[i]
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Check className="size-4" />
              </button>
              <Input
                placeholder={`Option ${i + 1}`}
                value={label}
                onChange={(e) => setLabel(i, e.target.value)}
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              labels.value = [...labels.value, ""];
              multiCorrect.value = [...multiCorrect.value, false];
            }}
          >
            <Plus className="mr-2 size-4" />
            Add option
          </Button>
        </div>
      )}

      {/* Short answer */}
      {kind.value === "short_answer" && (
        <div className="space-y-2">
          <Label className="text-xs">Accepted answers</Label>
          {labels.value.map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder={`Accepted answer ${i + 1}`}
                value={label}
                onChange={(e) => setLabel(i, e.target.value)}
              />
              {labels.value.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    labels.value = labels.value.filter((_, idx) => idx !== i);
                  }}
                >
                  <Trash2 className="size-4 text-muted-foreground" />
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => (labels.value = [...labels.value, ""])}
          >
            <Plus className="mr-2 size-4" />
            Add accepted answer
          </Button>
        </div>
      )}

      {/* Numeric */}
      {kind.value === "numeric" && (
        <div className="space-y-2">
          <Label className="text-xs">Answer and tolerance</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="numericAnswer" className="text-xs text-muted-foreground">Expected number</Label>
              <Input
                id="numericAnswer"
                type="number"
                step="any"
                placeholder="e.g. 3.14"
                value={numericAnswer.value}
                onChange={(e) => (numericAnswer.value = e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="numericTolerance" className="text-xs text-muted-foreground">Tolerance (±)</Label>
              <Input
                id="numericTolerance"
                type="number"
                min="0"
                step="any"
                placeholder="e.g. 0.01"
                value={numericTolerance.value}
                onChange={(e) => (numericTolerance.value = e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Any answer within [expected − tolerance, expected + tolerance] is awarded full points.
          </p>
        </div>
      )}

      {/* Essay */}
      {kind.value === "essay" && (
        <div className="rounded-md border p-3 bg-muted/20">
          <p className="text-xs text-muted-foreground">
            Essay questions allow open-ended student responses (up to 50,000 characters). They are scored manually by the teacher after submission.
          </p>
        </div>
      )}

      {/* Matching */}
      {kind.value === "matching" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Matching pairs</Label>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Scoring:</Label>
              <Select
                value={scoring.value}
                onValueChange={(v) =>
                  (scoring.value = v as "all_or_nothing" | "partial")
                }
                items={[
                  { value: "all_or_nothing", label: "All or nothing" },
                  { value: "partial", label: "Partial credit" },
                ]}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_or_nothing">All or nothing</SelectItem>
                  <SelectItem value="partial">Partial credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {matchingPairs.value.map((pair, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder={`Left item ${i + 1}`}
                value={pair.left}
                onChange={(e) => {
                  const next = [...matchingPairs.value];
                  next[i] = { ...next[i], left: e.target.value };
                  matchingPairs.value = next;
                }}
              />
              <span className="text-muted-foreground">→</span>
              <Input
                placeholder={`Right match ${i + 1}`}
                value={pair.right}
                onChange={(e) => {
                  const next = [...matchingPairs.value];
                  next[i] = { ...next[i], right: e.target.value };
                  matchingPairs.value = next;
                }}
              />
              {matchingPairs.value.length > 2 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    matchingPairs.value = matchingPairs.value.filter((_, idx) => idx !== i);
                  }}
                >
                  <Trash2 className="size-4 text-muted-foreground" />
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              matchingPairs.value = [...matchingPairs.value, { left: "", right: "" }];
            }}
          >
            <Plus className="mr-2 size-4" />
            Add pair
          </Button>
        </div>
      )}

      {/* Ordering */}
      {kind.value === "ordering" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Items in correct sequence</Label>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Scoring:</Label>
              <Select
                value={scoring.value}
                onValueChange={(v) =>
                  (scoring.value = v as "all_or_nothing" | "partial")
                }
                items={[
                  { value: "all_or_nothing", label: "All or nothing" },
                  { value: "partial", label: "Partial credit" },
                ]}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_or_nothing">All or nothing</SelectItem>
                  <SelectItem value="partial">Partial credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {orderingItems.value.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 text-xs text-muted-foreground font-semibold">{i + 1}.</span>
              <Input
                placeholder={`Step ${i + 1}`}
                value={item}
                onChange={(e) => {
                  const next = [...orderingItems.value];
                  next[i] = e.target.value;
                  orderingItems.value = next;
                }}
              />
              <div className="flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={i === 0}
                  onClick={() => {
                    const next = [...orderingItems.value];
                    const tmp = next[i - 1];
                    next[i - 1] = next[i];
                    next[i] = tmp;
                    orderingItems.value = next;
                  }}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={i === orderingItems.value.length - 1}
                  onClick={() => {
                    const next = [...orderingItems.value];
                    const tmp = next[i + 1];
                    next[i + 1] = next[i];
                    next[i] = tmp;
                    orderingItems.value = next;
                  }}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
              </div>
              {orderingItems.value.length > 2 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    orderingItems.value = orderingItems.value.filter((_, idx) => idx !== i);
                  }}
                >
                  <Trash2 className="size-4 text-muted-foreground" />
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              orderingItems.value = [...orderingItems.value, ""];
            }}
          >
            <Plus className="mr-2 size-4" />
            Add item
          </Button>
        </div>
      )}

      {/* File upload */}
      {kind.value === "file_upload" && (
        <div className="space-y-2">
          <Label className="text-xs">File upload requirements</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="fileTypes" className="text-xs text-muted-foreground">Accepted types (comma separated)</Label>
              <Input
                id="fileTypes"
                placeholder="e.g. .pdf, .docx, image/*"
                value={fileTypes.value}
                onChange={(e) => (fileTypes.value = e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fileMaxMb" className="text-xs text-muted-foreground">Max file size in MB (optional)</Label>
              <Input
                id="fileMaxMb"
                type="number"
                min="1"
                max="1000"
                placeholder="e.g. 10"
                value={fileMaxMb.value}
                onChange={(e) => (fileMaxMb.value = e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Students will upload a file matching these criteria. Scored manually by the teacher.
          </p>
        </div>
      )}

      <div className="flex items-end gap-2 pt-2">
        <div className="w-24 space-y-1">
          <Label className="text-xs">Points</Label>
          <Input
            type="number"
            min={0.01}
            step={0.5}
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
    </div>
  );
}
