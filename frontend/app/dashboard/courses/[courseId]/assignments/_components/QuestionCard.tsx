"use client";

import { toast } from "sonner";
import { api } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Check, FileUp, Hash, Pencil, Trash2, X } from "lucide-react";
import { QuestionForm, type QuestionPayload } from "./QuestionForm";
import { QUESTION_KIND_LABEL, type QuizQuestion } from "./types";
import { userMessage } from "@/lib/errors";

/**
 * One quiz question: read-only until the teacher opens it, then the same
 * editor used for writing a new one, over the same card.
 */
export function QuestionCard({
  question,
  index,
  activityId,
  bankId,
  canEdit,
  onChangedAction,
}: {
  question: QuizQuestion & { locked?: boolean };
  index: number;
  activityId?: string;
  bankId?: string;
  canEdit: boolean;
  onChangedAction: () => void;
}) {
  useSignals();

  const editing = useSignal(false);
  const saving = useSignal(false);

  async function save(payload: QuestionPayload) {
    saving.value = true;
    try {
      const url = bankId
        ? `/question-banks/${bankId}/questions/${question.id}`
        : `/activities/${activityId}/questions/${question.id}`;
      await api(url, {
        method: "PATCH",
        body: {
          prompt: payload.prompt,
          points: payload.points,
          options: payload.options,
          numericAnswer: payload.numericAnswer,
          numericTolerance: payload.numericTolerance,
          scoring: payload.scoring,
          rubricId: payload.rubricId,
          fileTypes: payload.fileTypes,
          fileMaxMb: payload.fileMaxMb,
        },
      });
      editing.value = false;
      toast.success("Question saved");
      onChangedAction();
    } catch (err) {
      toast.error(userMessage(err, "Failed to save"));
    } finally {
      saving.value = false;
    }
  }

  async function remove() {
    try {
      const url = bankId
        ? `/question-banks/${bankId}/questions/${question.id}`
        : `/activities/${activityId}/questions/${question.id}`;
      await api(url, {
        method: "DELETE",
      });
      onChangedAction();
    } catch (err) {
      toast.error(userMessage(err, "Failed to remove"));
    }
  }

  if (editing.value) {
    return (
      <Card className="border-primary/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Question {index + 1}</CardTitle>
        </CardHeader>
        <CardContent>
          <QuestionForm
            question={question}
            submitLabel="Save"
            busy={saving.value}
            onSubmitAction={save}
            onCancelAction={() => (editing.value = false)}
          />
        </CardContent>
      </Card>
    );
  }

  const kind = question.kind;
  const isShort = kind === "short_answer";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">
            {index + 1}. {question.prompt}
          </CardTitle>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline">
              {QUESTION_KIND_LABEL[kind]}
            </Badge>
            {question.scoring === "partial" && (
              <Badge variant="outline" className="text-xs">Partial credit</Badge>
            )}
            <Badge variant="secondary">{question.points} pt</Badge>
            {question.locked && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                In use
              </Badge>
            )}
            {canEdit && !question.locked && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => (editing.value = true)}
                  title="Edit question"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={remove}
                  title="Remove question"
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0">
        {(kind === "multiple_choice" || kind === "true_false" || kind === "multiple_select") && (
          <div className="space-y-1">
            {question.options.map((o) => (
              <div
                key={o.id}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                {o.isCorrect ? (
                  <Check className="size-4 text-emerald-600 shrink-0" />
                ) : (
                  <X className="size-4 opacity-30 shrink-0" />
                )}
                <span>{o.label}</span>
              </div>
            ))}
          </div>
        )}

        {isShort && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Accepted answers:</p>
            {question.options.map((o) => (
              <div key={o.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="size-4 text-emerald-600 shrink-0" />
                <span>{o.label}</span>
              </div>
            ))}
          </div>
        )}

        {kind === "numeric" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Hash className="size-4 text-primary shrink-0" />
            <span>
              Expected answer: <strong className="text-foreground">{question.numericAnswer}</strong>
              {question.numericTolerance ? ` (±${question.numericTolerance})` : " (exact)"}
            </span>
          </div>
        )}

        {kind === "essay" && (
          <p className="text-xs text-muted-foreground italic">
            Open-ended essay response. Marked manually by teacher.
          </p>
        )}

        {kind === "matching" && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Correct pairs:</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {question.options.map((o) => (
                <div key={o.id} className="flex items-center gap-2 text-xs rounded border px-2 py-1">
                  <span className="font-medium text-foreground">{o.label}</span>
                  <ArrowRight className="size-3 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">{o.matchLabel}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {kind === "ordering" && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Correct sequence:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-sm text-muted-foreground">
              {question.options.map((o) => (
                <li key={o.id} className="text-foreground font-medium">{o.label}</li>
              ))}
            </ol>
          </div>
        )}

        {kind === "file_upload" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileUp className="size-4 text-primary shrink-0" />
            <span>
              File upload required
              {question.fileMaxMb ? ` (up to ${question.fileMaxMb} MB)` : ""}
              {question.fileTypes?.length ? ` · Allowed: ${question.fileTypes.join(", ")}` : ""}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
