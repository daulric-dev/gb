"use client";

import { useEffect, useId } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Sparkles, X } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import type { CoursePageSummary } from "@/lib/courses/types";
import {
  AI_QUESTION_KINDS,
  aiDraftApi,
  aiErrorMessage,
  draftAsQuestion,
  type AiQuestionKind,
  type AiStatus,
  type QuestionDraft,
} from "@/lib/ai";
import { AiDraftNote } from "@/components/ai/ai-draft-note";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QuestionForm, type QuestionPayload } from "./QuestionForm";
import { QUESTION_KIND_LABEL } from "./types";

interface Draft {
  key: string;
  draft: QuestionDraft;
}

/**
 * "Draft questions with AI" in the quiz builder (feature `ai_assistance`).
 * The teacher picks a course page or pastes text, how many questions and
 * which kinds; the drafts appear below as editable forms, each saved only
 * when the teacher accepts it (the normal add-question route). Nothing is
 * saved by asking.
 */
export function AiQuestionDrafts({
  courseId,
  activityId,
  onAddedAction,
}: {
  courseId: string;
  activityId: string;
  onAddedAction: () => void;
}) {
  useSignals();
  const id = useId();
  const open = useSignal(false);
  const status = useSignal<AiStatus | null>(null);
  const pages = useSignal<CoursePageSummary[] | null>(null);
  const source = useSignal<"page" | "text">("page");
  const pageId = useSignal("");
  const text = useSignal("");
  const count = useSignal("5");
  const kinds = useSignal<AiQuestionKind[]>(["multiple_choice", "true_false", "short_answer"]);
  const working = useSignal(false);
  const drafts = useSignal<Draft[]>([]);
  const rejected = useSignal(0);
  const saving = useSignal<string | null>(null);

  useEffect(() => {
    if (!open.value || pages.value) return;
    api<CoursePageSummary[]>(`/courses/${courseId}/pages`)
      .then((p) => {
        pages.value = p;
        if (!p.length) source.value = "text";
        else if (!pageId.value) pageId.value = p[0].id;
      })
      .catch(() => (pages.value = []));
    aiDraftApi
      .status(courseId)
      .then((s) => (status.value = s))
      .catch(() => undefined);
  }, [open.value, courseId, pages, pageId, source, status]);

  const n = Number(count.value);
  const countOk = Number.isInteger(n) && n >= 1 && n <= 10;
  const ready =
    countOk &&
    kinds.value.length > 0 &&
    (source.value === "page" ? !!pageId.value : text.value.trim().length > 0) &&
    !!status.value?.provider;

  function toggleKind(k: AiQuestionKind, on: boolean) {
    kinds.value = on ? [...kinds.value, k] : kinds.value.filter((x) => x !== k);
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    working.value = true;
    try {
      const out = await aiDraftApi.quizQuestions(courseId, {
        ...(source.value === "page" ? { pageId: pageId.value } : { text: text.value }),
        count: n,
        kinds: kinds.value,
      });
      const stamp = Date.now();
      drafts.value = [
        ...drafts.value,
        ...out.drafts.map((d, i) => ({ key: `ai-${stamp}-${i}`, draft: d })),
      ];
      rejected.value = out.rejected;
      open.value = false;
      toast.success(
        out.drafts.length
          ? `${out.drafts.length} draft question${out.drafts.length === 1 ? "" : "s"} to review`
          : "The AI returned no usable questions. Try again or change the source.",
      );
    } catch (err) {
      toast.error(aiErrorMessage(err));
    } finally {
      working.value = false;
    }
  }

  async function accept(key: string, payload: QuestionPayload) {
    saving.value = key;
    try {
      await api(`/activities/${activityId}/questions`, { method: "POST", body: payload });
      drafts.value = drafts.value.filter((d) => d.key !== key);
      toast.success("Question added");
      onAddedAction();
    } catch (err) {
      toast.error(userMessage(err, "Failed to add the question"));
    } finally {
      saving.value = null;
    }
  }

  const discard = (key: string) => (drafts.value = drafts.value.filter((d) => d.key !== key));

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => (open.value = true)}>
        <Sparkles className="mr-1.5 size-4" aria-hidden />
        Draft questions with AI
      </Button>

      {drafts.value.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">AI drafts ({drafts.value.length})</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => (drafts.value = [])}>
              Discard all
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <AiDraftNote>
              Check every question, answer and option. A draft is added to the quiz only when you
              accept it.
              {rejected.value > 0 &&
                ` ${rejected.value} draft${rejected.value === 1 ? " was" : "s were"} left out because ${rejected.value === 1 ? "it" : "they"} broke the question rules.`}
            </AiDraftNote>
            <ol className="space-y-4">
              {drafts.value.map(({ key, draft }, i) => (
                <li key={key} className="space-y-2 rounded-lg border border-dashed p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      Draft {i + 1} · {QUESTION_KIND_LABEL[draft.kind]}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Discard draft ${i + 1}`}
                      onClick={() => discard(key)}
                    >
                      <X className="mr-1 size-4" aria-hidden />
                      Discard
                    </Button>
                  </div>
                  {draft.explanation && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Why (for you, not saved):</span> {draft.explanation}
                    </p>
                  )}
                  <QuestionForm
                    question={draftAsQuestion(draft, key)}
                    submitLabel="Accept and add"
                    busy={saving.value === key}
                    onSubmitAction={(payload) => void accept(key, payload)}
                  />
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <Dialog open={open.value} onOpenChange={(o) => (open.value = o)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <form onSubmit={generate} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Draft questions with AI</DialogTitle>
              <DialogDescription>
                The drafts are suggestions for you to check and edit. Nothing is added to the quiz
                until you accept it.
              </DialogDescription>
            </DialogHeader>

            {status.value && (
              <p className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">{status.value.notice}</p>
            )}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Write from</legend>
              <RadioGroup
                value={source.value}
                onValueChange={(v) => (source.value = v as "page" | "text")}
                className="flex flex-wrap gap-4"
              >
                <Label className="flex items-center gap-2 font-normal">
                  <RadioGroupItem value="page" disabled={!pages.value?.length} />
                  A course page
                </Label>
                <Label className="flex items-center gap-2 font-normal">
                  <RadioGroupItem value="text" />
                  Pasted text
                </Label>
              </RadioGroup>
              {source.value === "page" ? (
                <NativeSelect
                  aria-label="Course page"
                  className="w-full"
                  value={pageId.value}
                  onChange={(e) => (pageId.value = e.target.value)}
                >
                  {(pages.value ?? []).map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : (
                <Textarea
                  aria-label="Text to write questions from"
                  rows={8}
                  maxLength={30000}
                  value={text.value}
                  placeholder="Paste the material the questions should cover"
                  onChange={(e) => (text.value = e.target.value)}
                />
              )}
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor={`${id}-count`}>How many questions (1-10)</Label>
              <Input
                id={`${id}-count`}
                type="number"
                min={1}
                max={10}
                className="w-24"
                value={count.value}
                aria-invalid={!countOk}
                onChange={(e) => (count.value = e.target.value)}
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Question types</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {AI_QUESTION_KINDS.map((k) => (
                  <Label key={k} className="flex items-center gap-2 font-normal">
                    <Checkbox
                      checked={kinds.value.includes(k)}
                      onCheckedChange={(v) => toggleKind(k, v === true)}
                    />
                    {QUESTION_KIND_LABEL[k]}
                  </Label>
                ))}
              </div>
            </fieldset>

            {status.value && !status.value.provider && (
              <p className="text-sm text-destructive">
                Your organisation has not set up an AI provider yet.
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => (open.value = false)} disabled={working.value}>
                Cancel
              </Button>
              <Button type="submit" disabled={!ready || working.value}>
                {working.value && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
                {working.value ? "Drafting…" : "Draft questions"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
