"use client";

import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { QuestionForm, type QuestionPayload } from "./QuestionForm";
import { QUESTION_KIND_LABEL, type QuizQuestion } from "./types";

/**
 * One quiz question: read-only until the teacher opens it, then the same
 * editor used for writing a new one, over the same card.
 *
 * Editing is only offered on a draft. Once a quiz is published, students'
 * answers point at these options, so changing the prompt or the answer key
 * would rescore work already handed in - the API refuses it too.
 */
export function QuestionCard({
  question,
  index,
  activityId,
  canEdit,
  onChangedAction,
}: {
  question: QuizQuestion;
  index: number;
  activityId: string;
  canEdit: boolean;
  onChangedAction: () => void;
}) {
  useSignals();

  const editing = useSignal(false);
  const saving = useSignal(false);

  async function save(payload: QuestionPayload) {
    saving.value = true;
    try {
      await api(`/activities/${activityId}/questions/${question.id}`, {
        method: "PATCH",
        body: {
          prompt: payload.prompt,
          points: payload.points,
          options: payload.options,
        },
      });
      editing.value = false;
      toast.success("Question saved");
      onChangedAction();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      saving.value = false;
    }
  }

  async function remove() {
    try {
      await api(`/activities/${activityId}/questions/${question.id}`, {
        method: "DELETE",
      });
      onChangedAction();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove");
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

  const isShort = question.kind === "short_answer";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">
            {index + 1}. {question.prompt}
          </CardTitle>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline">
              {QUESTION_KIND_LABEL[question.kind]}
            </Badge>
            <Badge variant="secondary">{question.points} pt</Badge>
            {canEdit && (
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
      <CardContent className="space-y-1 pt-0">
        {isShort && (
          <p className="text-xs text-muted-foreground">Accepted answers</p>
        )}
        {question.options.map((o) => (
          <div
            key={o.id}
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            {isShort ? (
              <Check className="size-4 text-emerald-600" />
            ) : o.isCorrect ? (
              <Check className="size-4 text-emerald-600" />
            ) : (
              <X className="size-4 opacity-30" />
            )}
            {o.label}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
